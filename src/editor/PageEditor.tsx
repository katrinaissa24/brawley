/**
 * PageEditor — surface 3. A fixed overlay above the book with an opaque paper backdrop, a slim
 * header (title input, date button, autosave dot, page number), and the page: an UNSCALED box
 * `[data-editor-page]` (registered with setEditorPageEl for the book's FLIP) whose inner layer is
 * scaled to fit (Cmd+0 / − / = zoom). The InsertRail sits beside the page in the same unscaled
 * stage. DocumentView does the rendering + gestures; this file owns chrome, keys, insertion,
 * paste/drop, page navigation, overflow continuation, the dot-grid moods and the save chime.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flip } from '@/book/flip'
import { S } from '@/copy/strings'
import { MOTION } from '@/feel/motion'
import { sound } from '@/feel/sound'
import { formatLong } from '@/lib/dates'
import { isMediaFile, useImageUrl } from '@/lib/db'
import { HUES, INK, coverHex, inkFor } from '@/model/palette'
import { useEntry, useStore } from '@/model/store'
import { CONTENT, COVER_PAGE, PAGE, PAGE_MARGIN, PITCH, type Entry, type Id, type Rect, type StickerSource, type TextBlock, type TextFont, type TextKind } from '@/model/types'
import { BubbleToolbar } from './BubbleToolbar'
import { DocumentView } from './DocumentView'
import { ImageToolbar } from './ImageToolbar'
import { InsertRail } from './InsertRail'
import { hourSlot, splitAtOverflow } from './blocks/TextBody'
import { selectionRect } from './caret'
import { addBlock, addPageAfter, pageOf, continueOnNextPage, firstFreeRow, newStickerBlock, newTextBlock, readingOrder, textBlocks, updateBlock } from './ops'
import { sanitizeHtml } from './sanitize'
import { EditorSession } from './session'
import { CONTENT_MAX_X, CONTENT_MAX_Y } from './snap'
import { randomRotation, stickerById } from './stickers'
import { useImageImport } from './useImageImport'
import './editor.css'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 1.25
const ZOOM_STEP = 0.1
const fitScale = () => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((window.innerWidth - 96) / PAGE.w, (window.innerHeight - 140) / PAGE.h)))
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })
const sameRect = (a: Rect | null, b: Rect | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

export function PageEditor() {
  const route = useStore(s => s.route)
  const entry = useEntry(route.view === 'editor' ? route.entryId : null)
  if (route.view !== 'editor' || !entry) return null
  // COVER_PAGE edits the front cover's design; everything else is clamped to a real page
  const pageIndex = route.pageIndex === COVER_PAGE ? COVER_PAGE : Math.max(0, Math.min(route.pageIndex, entry.pages.length - 1))
  return <Editor key={entry.id} entry={entry} pageIndex={pageIndex} routeIndex={route.pageIndex} />
}

function Editor({ entry, pageIndex, routeIndex }: { entry: Entry; pageIndex: number; routeIndex: number }) {
  const session = useMemo(() => new EditorSession(entry.id, pageIndex), [entry.id])
  if (session.pageIndex !== pageIndex) { session.pageIndex = pageIndex; session.mounted = false }
  useEffect(() => () => session.dispose(), [session])

  const saveState = useStore(s => s.saveState)
  const selection = useStore(s => s.selection)
  const editingId = useStore(s => s.editingBlockId)
  const cropping = useStore(s => s.croppingBlockId)
  const isCover = pageIndex === COVER_PAGE
  const page = pageOf(entry, pageIndex)!
  const blocks = page.blocks

  const [scale, setScale] = useState(fitScale)
  const userZoom = useRef(false)
  const [gesture, setGesture] = useState(false)
  const [bubble, setBubble] = useState<{ anchor: Rect; id: Id } | null>(null)
  const [imgAnchor, setImgAnchor] = useState<Rect | null>(null)
  const [overflowIds, setOverflowIds] = useState<Id[]>([])
  const [dir, setDir] = useState(0)
  const [closing, setClosing] = useState(false)
  const [words, setWords] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const scaledRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const replaceFor = useRef<Id | null>(null)
  const { importFiles, replaceImage, pending } = useImageImport(session)

  /* ---------- route sanity ---------- */
  useEffect(() => {
    if (routeIndex !== pageIndex) useStore.getState().openPage(entry.id, pageIndex)
  }, [routeIndex, pageIndex, entry.id])

  /* ---------- page element for the book's FLIP ---------- */
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    useStore.getState().setEditorPageEl(el)
    return () => { if (useStore.getState().editorPageEl === el) useStore.getState().setEditorPageEl(null) }
  }, [])
  useLayoutEffect(() => {
    session.pageEl = scaledRef.current
    return () => { session.pageEl = null }
  }, [session])

  /* ---------- zoom ---------- */
  useEffect(() => { useStore.getState().setScale(scale) }, [scale])
  useEffect(() => {
    const on = () => { if (!userZoom.current) setScale(fitScale()) }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const zoom = useCallback((d: 1 | -1 | 'fit') => {
    session.flushAll()
    if (d === 'fit') { userZoom.current = false; setScale(fitScale()); return }
    userZoom.current = true
    setScale(s => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((s + d * ZOOM_STEP) * 100) / 100)))
  }, [session])

  /* ---------- gesture / overflow / replace / import events ---------- */
  useEffect(() => {
    const over = new Set<Id>()
    const sync = () => {
      for (const id of Array.from(over)) if (!session.textEls.has(id)) over.delete(id)
      setOverflowIds(prev => {
        const next = Array.from(over)
        return prev.length === next.length && prev.every((x, i) => x === next[i]) ? prev : next
      })
    }
    const offs = [
      session.on('gesture', (on: boolean) => setGesture(on)),
      session.on('measure', (id: Id, h: number) => {
        const b = session.block(id)
        if (!b) return
        const isOver = b.y * PITCH + h > CONTENT.y + CONTENT.h
        if (isOver) over.add(id); else over.delete(id)
        sync()
      }),
      session.on('blocksChanged', sync),
      session.on('replace', (id: Id) => { replaceFor.current = id; fileRef.current?.click() }),
      session.on('import', (files: File[]) => { void importFiles(files) }),
    ]
    return () => offs.forEach(f => f())
  }, [session, importFiles])

  /* ---------- starter block + focus after the FLIP lands ---------- */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const e = session.entry()
      const p = e && pageOf(e, session.pageIndex)
      if (!e || !p || session.pageIndex === COVER_PAGE) return // a cover starts bare
      const texts = readingOrder(textBlocks(p.blocks))
      if (!p.blocks.length) {
        const nb = newTextBlock('body', PAGE_MARGIN, PAGE_MARGIN, CONTENT.cols)
        session.commit(en => addBlock(en, session.pageIndex, nb), { silent: true })
        if (!e.title && session.pageIndex === 0) titleRef.current?.focus({ preventScroll: true })
        else session.focus(nb.id, 'start')
        return
      }
      if (!e.title && session.pageIndex === 0) { titleRef.current?.focus({ preventScroll: true }); return }
      const last = texts[texts.length - 1]
      if (last) session.focus(last.id, 'end')
    }, MOTION.reduced ? 180 : 460)
    return () => window.clearTimeout(t)
  }, [session, pageIndex])

  /* ---------- bubble toolbar: 250ms after the selection settles (400ms for a caret in an empty block) ---------- */
  useEffect(() => {
    let t = 0
    const hide = () => setBubble(b => (b ? null : b))
    const compute = () => {
      t = 0
      const st = useStore.getState()
      const id = st.editingBlockId
      if (!id || session.gesture) { hide(); return }
      const el = session.textEls.get(id)
      const sel = window.getSelection()
      if (!el || !sel || !sel.rangeCount || !el.contains(sel.getRangeAt(0).startContainer)) { hide(); return }
      if (sel.isCollapsed && el.dataset.empty !== '1') { hide(); return }
      const r = selectionRect()
      if (!r) { hide(); return }
      const anchor = toRect(r)
      setBubble(prev => (prev && prev.id === id && sameRect(prev.anchor, anchor) ? prev : { anchor, id }))
    }
    const on = () => {
      window.clearTimeout(t)
      const collapsed = window.getSelection()?.isCollapsed ?? true
      t = window.setTimeout(compute, collapsed ? 400 : 250)
    }
    document.addEventListener('selectionchange', on)
    return () => { document.removeEventListener('selectionchange', on); window.clearTimeout(t) }
  }, [session])
  useEffect(() => { if (!editingId || gesture) setBubble(b => (b ? null : b)) }, [editingId, gesture])

  /* ---------- image toolbar anchor (under the selected picture; never during a gesture) ---------- */
  const imageSel = selection.length === 1 ? blocks.find(b => b.id === selection[0] && b.type === 'image') : undefined
  const imgKey = imageSel && imageSel.type === 'image' ? `${imageSel.id}:${imageSel.x},${imageSel.y},${imageSel.w},${imageSel.h},${imageSel.rotation ?? 0},${imageSel.frame ?? ''}` : ''
  const measureImage = useCallback(() => {
    const st = useStore.getState()
    const id = st.selection.length === 1 ? st.selection[0] : null
    const b = id ? session.block(id) : undefined
    const el = id ? session.els.get(id) : undefined
    if (!b || b.type !== 'image' || !el || session.gesture) { setImgAnchor(a => (a ? null : a)); return }
    const r = toRect(el.getBoundingClientRect())
    setImgAnchor(a => (sameRect(a, r) ? a : r))
  }, [session])
  useLayoutEffect(() => { measureImage() }, [measureImage, imgKey, gesture, scale])

  /* ---------- keys (capture, so the editor's Esc ladder runs before App's) ---------- */
  const go = useCallback((d: -1 | 1) => {
    const n = pageIndex + d
    const e = session.entry()
    if (!e || pageIndex === COVER_PAGE || n < 0 || n >= e.pages.length) return
    session.flushAll()
    setDir(d)
    useStore.getState().openPage(entry.id, n)
  }, [session, pageIndex, entry.id])
  const addPage = useCallback(() => {
    session.flushAll()
    const e = session.entry()
    if (!e || pageIndex === COVER_PAGE) return
    const r = addPageAfter(e, pageIndex)
    useStore.getState().commitEntry(r.entry)
    setDir(1)
    useStore.getState().openPage(entry.id, r.index)
    useStore.getState().toast(S.editor.pageAdded)
  }, [session, pageIndex, entry.id])
  const close = useCallback(() => {
    session.flushAll()
    setClosing(true)
    void flip.closeEditor()
  }, [session])
  const openStickerPicker = useCallback(() => {
    railRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()
  }, [])

  const addSticker = useCallback((source: StickerSource, w: number, h: number) => {
    session.flushAll()
    const def = source.type === 'svg' ? stickerById(source.id) : undefined
    const rotation = def ? randomRotation(def) : Math.round((Math.random() * 8 - 4) * 10) / 10
    const opacity = def?.opacity
    // land at the caret when writing, else at the page centre
    let at = { x: Math.round(PAGE.cols / 2 - w / 2), y: Math.round(PAGE.rows / 2 - h / 2) }
    const st = useStore.getState()
    const editingEl = st.editingBlockId ? session.textEls.get(st.editingBlockId) : null
    const layer = scaledRef.current
    if (editingEl && layer) {
      const r = selectionRect()
      const pr = layer.getBoundingClientRect()
      if (r) at = { x: Math.round((r.left - pr.left) / scale / PITCH), y: Math.round((r.bottom - pr.top) / scale / PITCH) }
    }
    at.x = Math.min(Math.max(at.x, PAGE_MARGIN), CONTENT_MAX_X - w)
    at.y = Math.min(Math.max(at.y, PAGE_MARGIN), CONTENT_MAX_Y - h)
    const nb = newStickerBlock(source, w, h, at, { rotation: rotation || undefined, opacity })
    session.justAdded.add(nb.id)
    session.commit(e => addBlock(e, session.pageIndex, nb))
    st.select([nb.id])
  }, [session, scale])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const root = rootRef.current
      const inEditable = !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
      const st = useStore.getState()
      const meta = e.metaKey || e.ctrlKey
      if (t && t.closest && t.closest('.ed-stickers, .ed-stkmaker')) return // the sticker picker owns its keys
      if (e.key === 'Escape') {
        if (st.popover) return
        if (t === titleRef.current) { e.preventDefault(); titleRef.current?.blur(); return }
        if (inEditable && t && root && root.contains(t) && t.isContentEditable) return // TextBody: editing → selected
        if (inEditable) return // another field (search…) owns Esc
        if (st.croppingBlockId) { e.preventDefault(); st.setCropping(null); return }
        if (st.editingBlockId) { e.preventDefault(); st.setEditing(null); return }
        if (st.selection.length) { e.preventDefault(); st.select([]); return }
        e.preventDefault()
        close()
        return
      }
      if (meta && !e.altKey) {
        if (!e.shiftKey && e.key === '[') { e.preventDefault(); go(-1); return }
        if (!e.shiftKey && e.key === ']') { e.preventDefault(); go(1); return }
        if (e.shiftKey && e.code === 'KeyE') { e.preventDefault(); addPage(); return }
        if (!e.shiftKey && e.key === '0') { e.preventDefault(); zoom('fit'); return }
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoom(1); return }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(-1); return }
        if (e.shiftKey && e.code === 'KeyI') { e.preventDefault(); replaceFor.current = null; fileRef.current?.click(); return }
        if (e.shiftKey && e.code === 'KeyS') { e.preventDefault(); openStickerPicker(); return }
        if (e.shiftKey && e.code === 'KeyD') {
          e.preventDefault()
          const def = stickerById('date-stamp')
          if (def) addSticker({ type: 'svg', id: def.id }, def.w, def.h)
          return
        }
      }
      if (inEditable || st.popover) return
      const ctl = session.controller
      if (!ctl || !st.selection.length) return
      const k = e.key
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault()
        ctl.nudge(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0, e.shiftKey)
        return
      }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); ctl.remove(st.selection); return }
      if (meta && k.toLowerCase() === 'd') { e.preventDefault(); ctl.duplicate(st.selection[0]); return }
      if (!meta && (k === '[' || k === ']')) { e.preventDefault(); ctl.reorder(st.selection[0], k === ']' ? 1 : -1); return }
      if (k === 'Enter') {
        const b = session.block(st.selection[0])
        if (b?.type === 'text') { e.preventDefault(); session.focus(b.id, 'end') }
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [session, go, addPage, zoom, close, openStickerPicker, addSticker])

  /* ---------- paste onto the page (nothing focused) ---------- */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (useStore.getState().popover) return
      const files = Array.from(e.clipboardData?.files ?? []).filter(isMediaFile)
      if (files.length) { e.preventDefault(); void importFiles(files); return }
      const html = e.clipboardData?.getData('text/html') ?? ''
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!html && !text.trim()) return
      e.preventDefault()
      const p = session.page()
      if (!p) return
      const y = firstFreeRow(p.blocks, session.heights, 2)
      const nb = newTextBlock('body', PAGE_MARGIN, y, CONTENT.cols, html ? sanitizeHtml(html) : sanitizeHtml(text.split(/\r?\n/).map(l => `<p>${escapeHtml(l)}</p>`).join('')))
      session.justAdded.add(nb.id)
      session.commit(en => addBlock(en, session.pageIndex, nb))
      session.focus(nb.id, 'end')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [session, importFiles])

  /* ---------- drag-drop of files: snapped dashed ghost, then place at the drop cell ---------- */
  const dropCell = useRef<{ x: number; y: number } | null>(null)
  const ghostAt = (clientX: number, clientY: number) => {
    const layer = scaledRef.current
    const ghost = ghostRef.current
    if (!layer || !ghost) return
    const pr = layer.getBoundingClientRect()
    const gw = 18, gh = 12
    let cx = Math.round((clientX - pr.left) / scale / PITCH - gw / 2)
    let cy = Math.round((clientY - pr.top) / scale / PITCH - gh / 2)
    cx = Math.min(Math.max(cx, PAGE_MARGIN), CONTENT_MAX_X - gw)
    cy = Math.min(Math.max(cy, PAGE_MARGIN), CONTENT_MAX_Y - gh)
    dropCell.current = { x: cx, y: cy }
    ghost.style.setProperty('--gx', cx * PITCH + 'px')
    ghost.style.setProperty('--gy', cy * PITCH + 'px')
    ghost.style.setProperty('--gw', gw * PITCH + 'px')
    ghost.style.setProperty('--gh', gh * PITCH + 'px')
    ghost.dataset.on = '1'
  }
  const ghostOff = () => { ghostRef.current?.removeAttribute('data-on'); dropCell.current = null }
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    ghostAt(e.clientX, e.clientY)
  }
  const onDragLeave = (e: React.DragEvent) => {
    const to = e.relatedTarget as Node | null
    if (to && rootRef.current?.contains(to)) return
    ghostOff()
  }
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(isMediaFile)
    const at = dropCell.current ?? undefined
    ghostOff()
    if (files.length) void importFiles(files, at)
    else useStore.getState().toast(S.editor.image.unsupported)
  }

  /* ---------- dots step aside while you write; wake on pointer travel ---------- */
  useEffect(() => {
    const layer = scaledRef.current
    const root = rootRef.current
    if (!layer || !root) return
    let t = 0
    let armed = false
    let last: { x: number; y: number } | null = null
    const offTyping = session.on('typing', () => {
      if (armed) return
      armed = true
      window.clearTimeout(t)
      t = window.setTimeout(() => { layer.dataset.typing = '1' }, 400)
    })
    const onMove = (e: PointerEvent) => {
      if (!last) { last = { x: e.clientX, y: e.clientY }; return }
      if (Math.hypot(e.clientX - last.x, e.clientY - last.y) > 6) {
        last = { x: e.clientX, y: e.clientY }
        if (armed) { armed = false; window.clearTimeout(t); delete layer.dataset.typing }
      }
    }
    root.addEventListener('pointermove', onMove, { passive: true })
    return () => { offTyping(); root.removeEventListener('pointermove', onMove); window.clearTimeout(t) }
  }, [session])

  /* ---------- save chime discipline: session > 3s, idle ≥ 1.5s, engine gates 20s ---------- */
  useEffect(() => {
    const mountedAt = performance.now()
    let lastInput = 0
    let t = 0
    const offTyping = session.on('typing', () => { lastInput = performance.now() })
    const unsub = useStore.subscribe((s, prev) => {
      if (s.entries[entry.id] !== prev.entries[entry.id] && s.entries[entry.id]?.updatedAt !== prev.entries[entry.id]?.updatedAt) lastInput = performance.now()
      if (s.saveState === 'saved' && prev.saveState !== 'saved') {
        window.clearTimeout(t)
        const now = performance.now()
        if (now - mountedAt < 3000) return
        const wait = Math.max(0, 1500 - (now - lastInput))
        const stamp = lastInput
        t = window.setTimeout(() => {
          const st = useStore.getState()
          if (lastInput !== stamp || (st.saveState !== 'saved' && st.saveState !== 'idle')) return
          sound.chime()
        }, wait)
      }
    })
    return () => { offTyping(); unsub(); window.clearTimeout(t) }
  }, [session, entry.id])

  /* ---------- title ---------- */
  const [title, setTitle] = useState(entry.title)
  const titleFocused = useRef(false)
  const titleTimer = useRef(0)
  useEffect(() => { if (!titleFocused.current) setTitle(entry.title) }, [entry.title])
  const commitTitle = useCallback((v: string) => {
    window.clearTimeout(titleTimer.current)
    titleTimer.current = 0
    const e = session.entry()
    if (!e || e.title === v) return
    useStore.getState().updateEntry(entry.id, en => ({ ...en, title: v }), { coalesce: 'title' })
  }, [session, entry.id])
  const onTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setTitle(v)
    window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => commitTitle(v), 300)
  }
  const onTitleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      commitTitle(title)
      const p = session.page()
      const first = p ? readingOrder(textBlocks(p.blocks))[0] : undefined
      if (first) session.focus(first.id, 'start')
      else {
        const nb = newTextBlock('body', PAGE_MARGIN, PAGE_MARGIN, CONTENT.cols)
        session.commit(en => addBlock(en, session.pageIndex, nb))
        session.focus(nb.id, 'start')
      }
    }
  }
  useEffect(() => () => { window.clearTimeout(titleTimer.current) }, [])

  /* ---------- insertion (rail) ---------- */
  const onAddText = useCallback(() => {
    session.flushAll()
    const p = session.page()
    if (!p) return
    const y = firstFreeRow(p.blocks, session.heights, 2)
    const nb = newTextBlock('body', PAGE_MARGIN, y, CONTENT.cols)
    session.justAdded.add(nb.id)
    session.commit(e => addBlock(e, session.pageIndex, nb))
    session.focus(nb.id, 'start')
  }, [session])
  const onAddImage = useCallback((files: File[]) => { session.flushAll(); void importFiles(files) }, [session, importFiles])
  const onCover = useCallback(() => {
    const st = useStore.getState()
    const r = stageRef.current?.getBoundingClientRect()
    st.openPopover({ kind: 'cover', entryId: entry.id, anchor: r ? { x: r.left - 64, y: r.top + r.height / 2 - 22, w: 44, h: 44 } : { x: 48, y: window.innerHeight / 2, w: 44, h: 44 } })
  }, [entry.id])
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isMediaFile)
    e.target.value = ''
    const id = replaceFor.current
    replaceFor.current = null
    if (!files.length) return
    if (id) void replaceImage(id, files[0])
    else void importFiles(files)
  }

  /* ---------- bubble / image toolbar handlers ---------- */
  const bubbleBlock = bubble ? blocks.find(b => b.id === bubble.id && b.type === 'text') : undefined
  const onKind = useCallback((k: TextKind) => {
    const id = bubble?.id
    if (!id) return
    session.flushers.get(id)?.()
    session.commit(e => updateBlock<TextBlock>(e, session.pageIndex, id, { kind: k }))
    session.textEls.get(id)?.focus({ preventScroll: true })
  }, [bubble?.id, session])
  const onFont = useCallback((f: TextFont) => {
    const id = bubble?.id
    if (!id) return
    session.flushers.get(id)?.()
    session.commit(e => updateBlock<TextBlock>(e, session.pageIndex, id, { font: f === 'serif' ? undefined : f }))
    session.textEls.get(id)?.focus({ preventScroll: true })
  }, [bubble?.id, session])
  const onFormat = useCallback((cmd: Parameters<NonNullable<ReturnType<EditorSession['formatFns']['get']>>>[0]) => {
    const id = bubble?.id
    if (id) session.formatFns.get(id)?.(cmd)
  }, [bubble?.id, session])

  /* ---------- overflow: continue on the next page ---------- */
  const continueNext = useCallback(() => {
    const id = overflowIds[0]
    const b = id ? session.block(id) : undefined
    const el = id ? session.textEls.get(id) : undefined
    if (!b || b.type !== 'text' || !el) return
    session.flushAll()
    const split = splitAtOverflow(el, b.y * PITCH, CONTENT.y + CONTENT.h, scale)
    if (!split) return
    const cur = session.entry()
    if (!cur) return
    const r = continueOnNextPage(cur, pageIndex, b.id, split.keep, split.moved)
    session.justAdded.add(r.id)
    useStore.getState().commitEntry(r.entry)
    session.focus(r.id, 'start')
    setDir(1)
    useStore.getState().openPage(entry.id, r.page)
    useStore.getState().toast(S.editor.continued)
  }, [overflowIds, session, scale, pageIndex, entry.id])

  /* ---------- word count on a long press of the page number ---------- */
  const pressTimer = useRef(0)
  const pressStart = () => { window.clearTimeout(pressTimer.current); pressTimer.current = window.setTimeout(() => setWords(true), 400) }
  const pressEnd = () => { window.clearTimeout(pressTimer.current); setWords(false) }

  const E = S.editor
  const n = entry.stats.words
  const stageW = Math.round(PAGE.w * scale)
  const stageH = Math.round(PAGE.h * scale)
  const pageLabel = isCover ? E.coverPage : E.pageOf(pageIndex + 1, entry.pages.length)

  return (
    <div
      ref={rootRef}
      className={'ed' + (closing ? ' is-closing' : '')}
      role="dialog"
      aria-label={E.a11y.editor}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="ed-backdrop" data-ed-backdrop aria-hidden="true" />

      <header className="ed-header">
        <div className="ed-header__left" aria-hidden="true" />
        <div className="ed-header__centre">
          <input
            ref={titleRef}
            className="ed-title"
            value={title}
            placeholder={E.titlePlaceholder[hourSlot()]}
            aria-label={E.a11y.title}
            spellCheck
            onChange={onTitleChange}
            onKeyDown={onTitleKey}
            onFocus={() => { titleFocused.current = true }}
            onBlur={() => { titleFocused.current = false; commitTitle(title) }}
          />
          <button
            type="button"
            className="ed-date"
            aria-label={E.changeDate}
            title={E.changeDate}
            onClick={e => useStore.getState().openPopover({ kind: 'date', entryId: entry.id, anchor: toRect(e.currentTarget.getBoundingClientRect()) })}
          >
            {formatLong(entry.date)}
          </button>
        </div>
        <div className="ed-header__right">
          <SaveDot state={saveState} />
          <button
            type="button"
            className={'ed-pageno' + (words ? ' is-words' : '')}
            aria-label={words ? E.a11y.wordCount : pageLabel}
            onPointerDown={pressStart}
            onPointerUp={pressEnd}
            onPointerLeave={pressEnd}
            onPointerCancel={pressEnd}
            onContextMenu={e => e.preventDefault()}
          >
            {words ? E.words(n, Math.ceil(n / 200)) : pageLabel}
          </button>
        </div>
      </header>

      <div className="ed-scroll">
        <div ref={stageRef} className="ed-stage" style={{ width: stageW, height: stageH }}>
          <div ref={pageRef} className="ed-page" data-editor-page data-cover={isCover || undefined} aria-label={isCover ? E.coverPage : E.a11y.page} style={isCover ? coverStyle(entry) : undefined}>
            <div ref={scaledRef} className="ed-scaled" style={{ transform: `scale(${scale})` }}>
              {isCover && <CoverBackdrop entry={entry} />}
              <div className="ed-dots" aria-hidden="true" />
              <div className="ed-dots ed-dots--hot" aria-hidden="true" />
              <div key={pageIndex} className="ed-slide" style={{ '--dir': dir } as React.CSSProperties}>
                <DocumentView entry={entry} pageIndex={pageIndex} mode="edit" imageQuality="full" session={session} />
              </div>
              {pending.map(p => (
                <div
                  key={p.key}
                  className="ed-shimmer"
                  style={{ '--gx': p.x * PITCH + 'px', '--gy': p.y * PITCH + 'px', '--gw': p.w * PITCH + 'px', '--gh': p.h * PITCH + 'px' } as React.CSSProperties}
                  aria-hidden="true"
                />
              ))}
              <div ref={ghostRef} className="ed-ghost" aria-label={E.a11y.dropGhost} />
            </div>
          </div>
          <div ref={railRef} className="ed-rail-slot">
            <InsertRail onAddText={onAddText} onAddImage={onAddImage} onAddSticker={addSticker} onCover={onCover} />
          </div>
          {overflowIds.length > 0 && !isCover && (
            <div className="ed-overflow" role="status">
              <span className="ed-overflow__label">{E.overflow.label}</span>
              <button type="button" className="ed-overflow__btn" onClick={continueNext}>{E.overflow.action}</button>
            </div>
          )}
        </div>
      </div>

      {bubble && bubbleBlock && bubbleBlock.type === 'text' && !gesture && (
        <BubbleToolbar anchor={bubble.anchor} kind={bubbleBlock.kind} onKind={onKind} font={bubbleBlock.font ?? 'serif'} onFont={onFont} onFormat={onFormat} />
      )}
      {imageSel && imageSel.type === 'image' && imgAnchor && !gesture && (
        <ImageToolbar
          key={imageSel.id}
          block={imageSel}
          anchor={imgAnchor}
          reframing={cropping === imageSel.id}
          onReframe={on => useStore.getState().setCropping(on ? imageSel.id : null)}
          onChange={patch => {
            const id = imageSel.id
            const only = Object.keys(patch).length === 1
            const coalesce = only && 'opacity' in patch ? 'image-opacity:' + id
              : only && 'objectScale' in patch ? 'image-frame:' + id
              : undefined
            session.commit(e => updateBlock(e, session.pageIndex, id, b => ({ ...b, ...patch }) as typeof b), coalesce ? { coalesce } : undefined)
          }}
          onReplace={() => { replaceFor.current = imageSel.id; fileRef.current?.click() }}
          onRemove={() => session.controller?.remove([imageSel.id])}
        />
      )}
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden tabIndex={-1} aria-hidden="true" onChange={onFiles} />
    </div>
  )
}

/** Autosave dot: hollow ring while pending/saving, filled then fading when saved, accent + retry on failure. */
function SaveDot({ state }: { state: 'idle' | 'pending' | 'saving' | 'saved' | 'failed' }) {
  const V = S.editor.save
  const label = state === 'pending' ? V.pending : state === 'saving' ? V.saving : state === 'saved' ? V.saved : state === 'failed' ? V.failed : ''
  if (state === 'failed') {
    return (
      <button type="button" className="ed-savedot" data-state={state} title={`${V.failed} · ${V.retry}`} aria-label={`${V.failed}. ${V.retry}`} onClick={() => void useStore.getState().flushSave()} />
    )
  }
  return <span className="ed-savedot" data-state={state} title={label || undefined} role="status" aria-label={label || S.editor.a11y.autosave} />
}

/** The cover's colour, as the cover editor's page background. */
function coverStyle(entry: Entry): React.CSSProperties {
  const hex = coverHex(entry.cover)
  return { '--cover-hex': hex, '--cover-deep': HUES[entry.cover.hue][2], '--cover-ink': INK[inkFor(hex)] } as React.CSSProperties
}

/** What the design sits on: the cover picture and the title band, exactly where the book draws them. */
function CoverBackdrop({ entry }: { entry: Entry }) {
  const img = useImageUrl(entry.cover.imageId, 'full')
  const title = entry.title.trim()
  return (
    <div className="ed-coverbg" aria-hidden="true">
      {img && <img className="ed-coverbg__img" src={img} alt="" draggable={false} />}
      <div className={'ed-coverbg__band' + (title ? '' : ' -empty')}>{title || S.book.untitled}</div>
    </div>
  )
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

