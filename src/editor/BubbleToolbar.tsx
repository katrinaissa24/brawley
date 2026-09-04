/**
 * Bubble toolbar: floats 8px above the current text selection (below when there is no room),
 * with the block-kind segmented control, B I U S, Link and List. It never steals focus from the
 * contenteditable (mousedown is prevented on the whole capsule). Active states come from
 * document.queryCommandState on selectionchange, rAF-throttled, written straight to the buttons
 * (no React re-render per selection change).
 *
 * Also exports the shared FloatingCapsule (portal + placement + entrance motion) and the Glyph
 * icon wrapper used by the rest of the editor chrome.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { S } from '@/copy/strings'
import type { Rect, TextKind } from '@/model/types'
import './editor-chrome.css'

export type FormatCmd = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'link' | 'list'

export interface BubbleToolbarProps {
  /** Viewport rect (getBoundingClientRect-style) of the selection; null hides the toolbar. */
  anchor: Rect | null
  kind: TextKind
  onKind(k: TextKind): void
  onFormat(cmd: FormatCmd): void
}

const KINDS: TextKind[] = ['title', 'heading', 'body', 'quote', 'caption']
const FORMATS: FormatCmd[] = ['bold', 'italic', 'underline', 'strikeThrough', 'link', 'list']

export function BubbleToolbar({ anchor, kind, onKind, onFormat }: BubbleToolbarProps) {
  const btns = useRef<Partial<Record<FormatCmd, HTMLButtonElement | null>>>({})
  const visible = anchor !== null

  // active states ← selection, rAF-throttled, written imperatively
  useEffect(() => {
    if (!visible) return
    let raf = 0
    const apply = () => {
      raf = 0
      for (const cmd of FORMATS) {
        const el = btns.current[cmd]
        if (!el) continue
        const on = commandActive(cmd)
        el.setAttribute('aria-pressed', on ? 'true' : 'false')
        el.classList.toggle('is-active', on)
      }
    }
    const onSel = () => { if (!raf) raf = requestAnimationFrame(apply) }
    document.addEventListener('selectionchange', onSel)
    apply()
    return () => {
      document.removeEventListener('selectionchange', onSel)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [visible])

  if (!anchor) return null

  const onKindKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = KINDS.indexOf(kind)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % KINDS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + KINDS.length) % KINDS.length
    if (next < 0) return
    e.preventDefault()
    onKind(KINDS[next])
    ;(e.currentTarget.children[next] as HTMLElement | undefined)?.focus()
  }

  const C = S.editorChrome.bubble
  return (
    <FloatingCapsule anchor={anchor} place="above" gap={8} className="ed-bubble" role="toolbar" label={C.label}>
      <div className="ed-bubble__kinds" role="radiogroup" aria-label={C.kindMenu} onKeyDown={onKindKeys}>
        {KINDS.map(k => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            tabIndex={kind === k ? 0 : -1}
            className="ed-bubble__kind"
            data-kind={k}
            data-tip={tip(C.kinds[k], C.kindHints[k])}
            onClick={() => onKind(k)}
          >
            {C.kinds[k]}
          </button>
        ))}
      </div>
      <span className="ed-chrome-sep" aria-hidden="true" />
      {FORMATS.map(cmd => (
        <button
          key={cmd}
          type="button"
          ref={el => { btns.current[cmd] = el }}
          className="ed-bubble__btn ed-chrome-btn"
          aria-label={C.format[cmd]}
          data-cmd={cmd}
          data-tip={tip(C.format[cmd], C.formatHints[cmd])}
          onClick={() => onFormat(cmd)}
        >
          <FormatGlyph cmd={cmd} />
        </button>
      ))}
    </FloatingCapsule>
  )
}

export const tip = (label: string, hint?: string) => (hint ? `${label} ${hint}` : label)

function commandActive(cmd: FormatCmd): boolean {
  try {
    if (cmd === 'list') return document.queryCommandState('insertUnorderedList') || document.queryCommandState('insertOrderedList')
    if (cmd === 'link') {
      const sel = document.getSelection()
      let n: Node | null = sel?.anchorNode ?? null
      while (n) {
        if (n instanceof HTMLElement) {
          if (n.tagName === 'A') return true
          if (n.isContentEditable === false || n.hasAttribute('contenteditable')) break
        }
        n = n.parentNode
      }
      return false
    }
    return document.queryCommandState(cmd)
  } catch {
    return false
  }
}

function FormatGlyph({ cmd }: { cmd: FormatCmd }) {
  switch (cmd) {
    case 'bold':
      return <Glyph><path d="M5 3.5h5a3 3 0 0 1 0 6H5zM5 9.5h5.8a3 3 0 0 1 0 6H5z" strokeWidth="1.8" /></Glyph>
    case 'italic':
      return <Glyph><path d="M8 3.5h5.5M4.5 14.5H10M10.8 3.5 7.2 14.5" /></Glyph>
    case 'underline':
      return <Glyph><path d="M5 3v5.5a4 4 0 0 0 8 0V3M4 15.5h10" /></Glyph>
    case 'strikeThrough':
      return <Glyph><path d="M3 9h12M12.5 5.5C12 4 10.6 3 9 3 7 3 5.5 4.2 5.5 5.7c0 .9.4 1.6 1.2 2.1M6 12.6c.6 1.4 1.7 2.4 3.3 2.4 2 0 3.3-1.2 3.3-2.7 0-.5-.1-.9-.3-1.3" /></Glyph>
    case 'link':
      return <Glyph><path d="M7.5 10.5 10.5 7.5M8 5.2l1.4-1.4a2.9 2.9 0 0 1 4.1 4.1L12 9.4M6 8.6 4.5 10.1a2.9 2.9 0 0 0 4.1 4.1l1.4-1.4" /></Glyph>
    case 'list':
      return <Glyph><path d="M7 4.5h8M7 9h8M7 13.5h8" /><circle cx="3.6" cy="4.5" r=".9" fill="currentColor" stroke="none" /><circle cx="3.6" cy="9" r=".9" fill="currentColor" stroke="none" /><circle cx="3.6" cy="13.5" r=".9" fill="currentColor" stroke="none" /></Glyph>
  }
}

/* ---------- shared: icon wrapper ---------- */

/** 18px, 1.5px stroke, currentColor. Children are the path(s) in an 18×18 box. */
export function Glyph({ children, size = 18 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      className="ed-chrome-glyph"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/* ---------- shared: floating capsule ---------- */

export interface FloatingCapsuleProps {
  anchor: Rect
  /** preferred side; flips when there is no room */
  place: 'above' | 'below'
  gap: number
  className?: string
  role?: string
  label?: string
  /** 'pill' (999px) or 'card' (12px) */
  shape?: 'pill' | 'card'
  /** When true, mousedown inside is NOT prevented for range/text inputs (they need it). */
  allowInputFocus?: boolean
  children: React.ReactNode
}

/**
 * A paper capsule rendered into document.body (position: fixed, so scaled/transformed editor
 * ancestors never affect it), centred on the anchor and clamped to the viewport, entering with
 * opacity 0→1 / translateY 4→0 over 160ms. Position is measured in a layout effect and written on
 * the ref — anchor updates never re-render children.
 */
export function FloatingCapsule({ anchor, place, gap, className, role, label, shape = 'pill', allowInputFocus, children }: FloatingCapsuleProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { x, y, w, h } = anchor

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const position = () => {
      const ew = el.offsetWidth
      const eh = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const M = 8
      let side = place
      let top = side === 'above' ? y - eh - gap : y + h + gap
      if (side === 'above' && top < M) { side = 'below'; top = y + h + gap }
      else if (side === 'below' && top + eh > vh - M) { side = 'above'; top = y - eh - gap }
      top = Math.max(M, Math.min(vh - eh - M, top))
      const left = Math.max(M, Math.min(vw - ew - M, x + w / 2 - ew / 2))
      el.style.left = `${Math.round(left)}px`
      el.style.top = `${Math.round(top)}px`
      el.dataset.place = side
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [x, y, w, h, gap, place])

  const onMouseDown = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    if (allowInputFocus && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    e.preventDefault()
  }

  return createPortal(
    <div
      ref={ref}
      className={`ed-capsule ed-capsule--${shape}${className ? ' ' + className : ''}`}
      role={role}
      aria-label={label}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>,
    document.body,
  )
}
