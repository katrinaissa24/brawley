/**
 * TextBody — the uncontrolled contenteditable. React never renders children into it: innerHTML
 * is written only on mount and when the committed html differs from what we last applied
 * (undo/redo/import), with the caret saved/restored as text offsets. Typing commits to the store
 * after a 400ms pause, coalesced as one undo step per burst ('text:<id>'); the pending commit is
 * flushed on blur, before Enter/paste/format, before any gesture (session.flushAll) and on Cmd+Z
 * so the app-level undo always sees the latest text. In view mode it is a plain div.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useStore } from '@/model/store'
import { PITCH, type Id, type TextBlock, type TextKind } from '@/model/types'
import { S } from '@/copy/strings'
import type { FormatCmd } from '../BubbleToolbar'
import { placeCaret, restoreCaret, saveCaret, selectionAncestor, selectionRect, textBeforeCaretInParagraph } from '../caret'
import { addBlock, newTextBlock, readingOrder, removeBlock, textBlocks, updateBlock } from '../ops'
import { EMPTY_HTML, htmlToFragment, isEmptyEditable, isHttpUrl, normalizeHtml, sanitizeHtml, textToFragment } from '../sanitize'
import type { EditorSession } from '../session'

export interface TextBodyProps {
  block: TextBlock
  /** null in view mode */
  session: EditorSession | null
  placeholder: string
  onMeasure?: (heightPx: number) => void
}

const KIND_BY_DIGIT: Record<string, TextKind> = { Digit1: 'title', Digit2: 'heading', Digit3: 'body', Digit4: 'quote', Digit5: 'caption' }
const isHeadingKind = (k: TextKind) => k === 'title' || k === 'heading'

export const TextBody = memo(function TextBody({ block, session, placeholder, onMeasure }: TextBodyProps) {
  const ref = useRef<HTMLDivElement>(null)
  const lastApplied = useRef<string | null>(null)
  const lastRaw = useRef<string>('')
  const timer = useRef(0)
  const latest = useRef(block)
  latest.current = block
  const edit = session !== null
  const id = block.id

  const syncEmpty = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.dataset.empty = isEmptyEditable(el) ? '1' : '0'
  }, [])

  /* ---------- the ONLY place innerHTML is written ---------- */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (block.html === lastApplied.current) return
    window.clearTimeout(timer.current)
    timer.current = 0
    const focused = document.activeElement === el
    const caret = focused ? saveCaret(el) : null
    el.innerHTML = block.html || EMPTY_HTML
    lastApplied.current = block.html
    lastRaw.current = el.innerHTML
    if (caret) restoreCaret(el, caret)
    syncEmpty()
  }, [block.html, syncEmpty])

  /* ---------- commit ---------- */
  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = 0
    const el = ref.current
    if (!el || !session) return
    if (el.innerHTML === lastRaw.current) return
    lastRaw.current = el.innerHTML
    const html = normalizeHtml(el.innerHTML)
    if (html === lastApplied.current) return
    lastApplied.current = html
    const b = latest.current
    session.commit(e => updateBlock<TextBlock>(e, session.pageIndex, b.id, { html }), { coalesce: 'text:' + b.id })
  }, [session])

  const onInput = useCallback(() => {
    syncEmpty()
    session?.emit('typing')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 400)
  }, [flush, syncEmpty, session])

  /* ---------- registries ---------- */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !session) return
    session.textEls.set(id, el)
    session.flushers.set(id, flush)
    return () => {
      flush()
      session.textEls.delete(id)
      session.flushers.delete(id)
      session.heights.delete(id)
    }
  }, [session, id, flush])

  /* ---------- measure (ResizeObserver → heights map, guarded against loops) ---------- */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !onMeasure) return
    let last = -1
    let raf = 0
    const push = () => {
      raf = 0
      const h = el.offsetHeight
      if (Math.abs(h - last) < 1) return
      last = h
      onMeasure(h)
    }
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(push) })
    ro.observe(el)
    push()
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf) }
  }, [onMeasure])

  /* ---------- pending focus (block created by Enter / rail / continue) ---------- */
  useEffect(() => {
    const el = ref.current
    if (!el || !session) return
    const apply = (want: Id) => {
      if (want !== id) return
      const p = session.takeFocus(id)
      if (!p) return
      el.focus({ preventScroll: true })
      placeCaret(el, p.where)
    }
    apply(id)
    return session.on('focus', apply)
  }, [session, id])

  /* ---------- formatting (bubble toolbar + keys) ---------- */
  const format = useCallback((cmd: FormatCmd) => {
    const el = ref.current
    if (!el || !session) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    if (cmd === 'link') {
      const a = selectionAncestor(el, 'a')
      if (a) document.execCommand('unlink')
      else {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) return
        const url = window.prompt(S.editor.link.prompt, '') ?? ''
        if (!url) return
        const href = isHttpUrl(url) ? url.trim() : 'https://' + url.trim()
        if (!isHttpUrl(href)) return
        document.execCommand('createLink', false, href)
      }
    } else if (cmd === 'list') document.execCommand('insertUnorderedList')
    else document.execCommand(cmd)
    onInput()
    flush()
  }, [session, onInput, flush])
  useLayoutEffect(() => {
    if (!session) return
    session.formatFns.set(id, format)
    return () => { session.formatFns.delete(id) }
  }, [session, id, format])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!edit) {
    return <div ref={ref} className="ed-text" data-kind={block.kind} />
  }

  /* ---------- structural edits ---------- */
  const insertBodyBelow = () => {
    if (!session) return
    const b = latest.current
    const h = session.heights.get(b.id) ?? PITCH * 2
    const y = b.y + Math.ceil(h / PITCH) + 1
    const nb = newTextBlock('body', b.x, y, b.w)
    session.justAdded.add(nb.id)
    session.commit(e => addBlock(e, session.pageIndex, nb))
    session.focus(nb.id, 'start')
  }
  const removeAndFocusPrev = () => {
    if (!session) return
    const b = latest.current
    const page = session.page()
    if (!page) return
    const texts = readingOrder(textBlocks(page.blocks))
    const i = texts.findIndex(t => t.id === b.id)
    const prev = i > 0 ? texts[i - 1] : texts[i + 1]
    lastApplied.current = b.html // don't flush stale DOM on unmount
    lastRaw.current = ref.current?.innerHTML ?? ''
    session.commit(e => removeBlock(e, session.pageIndex, b.id))
    useStore.getState().select([])
    if (prev) session.focus(prev.id, i > 0 ? 'end' : 'start')
  }
  const moveFocus = (dir: -1 | 1) => {
    if (!session) return false
    const b = latest.current
    const page = session.page()
    if (!page) return false
    const texts = readingOrder(textBlocks(page.blocks))
    const i = texts.findIndex(t => t.id === b.id)
    const next = texts[i + dir]
    if (!next) return false
    flush()
    session.focus(next.id, dir > 0 ? 'start' : 'end')
    return true
  }
  const setKind = (kind: TextKind, html?: string) => {
    if (!session) return
    flush()
    const b = latest.current
    if (html !== undefined) { lastApplied.current = html; lastRaw.current = ref.current?.innerHTML ?? '' }
    session.commit(e => updateBlock<TextBlock>(e, session.pageIndex, b.id, html === undefined ? { kind } : { kind, html }))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || !session) return
    const b = latest.current
    const meta = e.metaKey || e.ctrlKey

    // Cmd+Z / Shift+Cmd+Z: flush, then let it bubble to App (which performs the undo)
    if (meta && !e.altKey && e.key.toLowerCase() === 'z') { flush(); return }

    if (e.key === 'Escape') {
      e.preventDefault()
      flush()
      el.blur()
      useStore.getState().select([b.id])
      return
    }
    if (e.key === 'Tab') { e.preventDefault(); return }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isHeadingKind(b.kind) || meta) { e.preventDefault(); flush(); insertBodyBelow(); return }
      if (b.kind === 'quote' || b.kind === 'caption') {
        // second Enter on an empty last paragraph leaves the quote for a body block below
        const info = textBeforeCaretInParagraph(el)
        const paras = el.querySelectorAll(':scope > p')
        if (info && paras.length > 1 && info.para === paras[paras.length - 1] && !(info.para.textContent ?? '').trim()) {
          e.preventDefault()
          info.para.remove()
          onInput()
          flush()
          insertBodyBelow()
          return
        }
      }
      // otherwise the browser inserts a <p> (defaultParagraphSeparator); mark an undo boundary
      window.setTimeout(flush, 0)
      return
    }
    if (e.key === 'Backspace' && !meta && isEmptyEditable(el) && el.querySelectorAll(':scope > p, :scope > ul, :scope > ol').length <= 1) {
      e.preventDefault()
      removeAndFocusPrev()
      return
    }
    // markdown triggers at the start of an empty body block
    if (e.key === ' ' && !meta && b.kind === 'body') {
      const info = textBeforeCaretInParagraph(el)
      const t = info?.text ?? ''
      if (info && (t === '#' || t === '>' || t === '-') && (info.para.textContent ?? '') === t && el.querySelectorAll(':scope > p').length === 1 && !el.querySelector('ul, ol')) {
        e.preventDefault()
        info.para.innerHTML = '<br>'
        placeCaret(el, 'start')
        if (t === '-') { document.execCommand('insertUnorderedList'); onInput(); flush() }
        else setKind(t === '#' ? 'heading' : 'quote', EMPTY_HTML)
        return
      }
    }
    // kinds: Cmd+Alt+1..5
    if (meta && e.altKey && KIND_BY_DIGIT[e.code]) {
      e.preventDefault()
      setKind(KIND_BY_DIGIT[e.code])
      return
    }
    // inline formatting
    if (meta && !e.altKey) {
      const k = e.key.toLowerCase()
      let cmd: FormatCmd | null = null
      if (!e.shiftKey && k === 'b') cmd = 'bold'
      else if (!e.shiftKey && k === 'i') cmd = 'italic'
      else if (!e.shiftKey && k === 'u') cmd = 'underline'
      else if (e.shiftKey && k === 'x') cmd = 'strikeThrough'
      else if (e.shiftKey && e.code === 'Digit8') cmd = 'list'
      if (cmd) { e.preventDefault(); format(cmd); return }
    }
    // arrow out of the block on the first/last line
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !meta && !e.altKey) {
      const sel = window.getSelection()
      if (!sel || !sel.isCollapsed) return
      const r = selectionRect()
      const box = el.getBoundingClientRect()
      if (!r) return
      const line = Math.max(1, r.height)
      if (e.key === 'ArrowUp' && r.top - box.top < line * 0.6) { if (moveFocus(-1)) e.preventDefault() }
      else if (e.key === 'ArrowDown' && box.bottom - r.bottom < line * 0.6) { if (moveFocus(1)) e.preventDefault() }
    }
  }

  const onBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const t = (e.nativeEvent as InputEvent).inputType
    if (t === 'historyUndo' || t === 'historyRedo') {
      e.preventDefault()
      flush()
      const s = useStore.getState()
      if (t === 'historyUndo') s.undo()
      else s.redo()
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = ref.current
    if (!el || !session) return
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'))
    if (files.length) { flush(); session.emit('import', files, latest.current.id); return }
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (!html && !text) return
    const frag = html ? htmlToFragment(sanitizeHtml(html)) : textToFragment(text)
    insertFragment(el, frag)
    onInput()
    flush()
  }

  const onFocus = () => {
    const s = useStore.getState()
    const b = latest.current
    s.setEditing(b.id)
    if (!(s.selection.length === 1 && s.selection[0] === b.id)) s.select([b.id])
  }
  const onBlur = () => {
    flush()
    const s = useStore.getState()
    if (s.editingBlockId === latest.current.id) s.setEditing(null)
  }

  return (
    <div
      ref={ref}
      className="ed-text"
      data-kind={block.kind}
      data-placeholder={placeholder}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="true"
      aria-label={S.editor.a11y.textBlock}
      onInput={onInput}
      onBeforeInput={onBeforeInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  )
})

/** Insert a fragment at the selection (inside `el`), paragraph-aware, and put the caret after it. */
function insertFragment(el: HTMLElement, frag: DocumentFragment) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !el.contains(sel.getRangeAt(0).startContainer)) {
    placeCaret(el, 'end')
  }
  const range = sel!.getRangeAt(0)
  range.deleteContents()
  const paras = Array.from(frag.childNodes)
  if (!paras.length) return
  // single paragraph: splice its inline content into the current paragraph
  if (paras.length === 1 && (paras[0] as HTMLElement).tagName === 'P') {
    const inline = document.createDocumentFragment()
    inline.append(...Array.from(paras[0].childNodes))
    const last = inline.lastChild
    range.insertNode(inline)
    if (last) { range.setStartAfter(last); range.collapse(true) }
  } else {
    // multi-paragraph: split the current paragraph and insert whole paragraphs between the halves
    const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as HTMLElement) : range.startContainer.parentElement
    const para = startEl?.closest('p, li')
    if (para && el.contains(para) && para.parentElement === el) {
      const tail = document.createRange()
      tail.setStart(range.startContainer, range.startOffset)
      tail.setEndAfter(para.lastChild ?? para)
      const tailFrag = tail.extractContents()
      const first = paras[0] as HTMLElement
      const lastP = paras[paras.length - 1] as HTMLElement
      // merge first pasted paragraph into the head, append the tail to the last pasted paragraph
      para.append(...Array.from(first.childNodes))
      if (lastP !== first) {
        const tailNodes = Array.from(tailFrag.childNodes)
        lastP.append(...tailNodes)
        const rest = paras.slice(1)
        let after: Node = para
        for (const p of rest) { (after as HTMLElement).after(p); after = p }
        const r = document.createRange()
        r.setStart(lastP, lastP.childNodes.length - tailNodes.length)
        r.collapse(true)
        sel!.removeAllRanges()
        sel!.addRange(r)
      } else {
        const marker = document.createTextNode('')
        para.append(marker, ...Array.from(tailFrag.childNodes))
        const r = document.createRange()
        r.setStart(marker, 0)
        r.collapse(true)
        sel!.removeAllRanges()
        sel!.addRange(r)
      }
      cleanupEmptyParas(el)
      return
    }
    const last = frag.lastChild
    range.insertNode(frag)
    if (last) { range.setStartAfter(last); range.collapse(true) }
  }
  sel!.removeAllRanges()
  sel!.addRange(range)
  cleanupEmptyParas(el)
}
function cleanupEmptyParas(el: HTMLElement) {
  for (const p of Array.from(el.querySelectorAll(':scope > p'))) {
    if (!p.childNodes.length) p.append(document.createElement('br'))
  }
}

/** Placeholder copy per kind; the body prompt rotates daily (never the same one two days running). */
export function placeholderFor(kind: TextKind, opts: { prompts: boolean; ordinal: number }): string {
  const P = S.editor
  if (kind === 'title') return P.titlePlaceholder[hourSlot()]
  if (kind === 'body') {
    if (!opts.prompts || opts.ordinal > 0) return P.placeholder.body
    const day = Math.floor(Date.now() / 86400000)
    return P.prompts[day % P.prompts.length]
  }
  return P.placeholder[kind]
}
export function hourSlot(): 'morning' | 'afternoon' | 'night' {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'night'
}

/** Split a text block's html at the first top-level paragraph whose top is past `boundaryPx` (page px). */
export function splitAtOverflow(textEl: HTMLElement, blockTopPx: number, boundaryPx: number, scale: number): { keep: string; moved: string } | null {
  const kids = Array.from(textEl.children) as HTMLElement[]
  if (kids.length < 2) return null
  const elTop = textEl.getBoundingClientRect().top
  let cut = -1
  for (let i = 1; i < kids.length; i++) {
    const top = blockTopPx + (kids[i].getBoundingClientRect().top - elTop) / scale
    if (top > boundaryPx) { cut = i; break }
  }
  if (cut < 0) cut = kids.length - 1
  const keep = kids.slice(0, cut).map(k => k.outerHTML).join('')
  const moved = kids.slice(cut).map(k => k.outerHTML).join('')
  return { keep: keep || EMPTY_HTML, moved: moved || EMPTY_HTML }
}

