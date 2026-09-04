/**
 * Popover primitive: anchored to a viewport Rect (or centred as a sheet), flips when out of room,
 * paper 96% background (no backdrop-filter), 1px rule, soft shadow, 12px radius, 160ms ease-out entry,
 * focus trap, Esc / outside click → store.closePopover(), restores focus on close.
 * Rendered through a portal so it never sits inside a 3D subtree.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Rect } from '@/model/types'
import { useStore } from '@/model/store'
import './ui.css'

export type Side = 'bottom' | 'top' | 'right' | 'left'
export interface PopoverProps {
  anchor?: Rect
  /** Preferred side; flips to the opposite when there is no room. */
  side?: Side
  /** Alignment along the anchor's edge (horizontal for top/bottom, vertical for left/right). */
  align?: 'start' | 'center' | 'end'
  width?: number
  /** Centred sheet with a scrim instead of an anchor. */
  sheet?: boolean
  label: string
  role?: 'dialog' | 'menu'
  className?: string
  /** Selector of the element to focus first; defaults to the first focusable. */
  initialFocus?: string
  onClose?: () => void
  children: ReactNode
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const GAP = 8
const EDGE = 12
const TRIGGER = '[data-popover-trigger]'

export function Popover(p: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef<() => void>(() => {})
  closeRef.current = () => { p.onClose?.(); useStore.getState().closePopover() }

  // position (before paint) + reposition on resize
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || p.sheet) return
    const layout = () => {
      const a = p.anchor ?? { x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 }
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = innerWidth
      const vh = innerHeight
      const align = p.align ?? 'start'
      let side: Side = p.side ?? 'bottom'
      let x = 0
      let y = 0
      if (side === 'right' || side === 'left') {
        const roomRight = vw - (a.x + a.w) - EDGE
        const roomLeft = a.x - EDGE
        if (side === 'right' && roomRight < w + GAP && roomLeft > roomRight) side = 'left'
        else if (side === 'left' && roomLeft < w + GAP && roomRight > roomLeft) side = 'right'
        x = side === 'right' ? a.x + a.w + GAP : a.x - w - GAP
        y = align === 'start' ? a.y : align === 'end' ? a.y + a.h - h : a.y + a.h / 2 - h / 2
      } else {
        const roomBelow = vh - (a.y + a.h) - EDGE
        const roomAbove = a.y - EDGE
        if (side === 'bottom' && roomBelow < h + GAP && roomAbove > roomBelow) side = 'top'
        else if (side === 'top' && roomAbove < h + GAP && roomBelow > roomAbove) side = 'bottom'
        y = side === 'bottom' ? a.y + a.h + GAP : a.y - h - GAP
        x = align === 'start' ? a.x : align === 'end' ? a.x + a.w - w : a.x + a.w / 2 - w / 2
      }
      x = Math.max(EDGE, Math.min(vw - w - EDGE, x))
      y = Math.max(EDGE, Math.min(vh - h - EDGE, y))
      el.style.left = `${Math.round(x)}px`
      el.style.top = `${Math.round(y)}px`
      el.dataset.side = side
    }
    layout()
    addEventListener('resize', layout)
    return () => removeEventListener('resize', layout)
  }, [p.anchor, p.side, p.align, p.sheet])

  // focus management: initial focus, restore on close
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const prev = document.activeElement as HTMLElement | null
    const first = (p.initialFocus && el.querySelector<HTMLElement>(p.initialFocus)) || el.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? el).focus({ preventScroll: true })
    return () => {
      if (prev && prev.isConnected && document.body.contains(prev)) prev.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc (document fires before App's window ladder), Tab trap, outside pointerdown, wheel outside
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key === 'Tab') {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(n => n.offsetParent !== null)
        if (!items.length) { e.preventDefault(); return }
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus() }
        else if (!e.shiftKey && (i === -1 || i === items.length - 1)) { e.preventDefault(); items[0].focus() }
      }
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || el.contains(t)) return
      if (t.closest(TRIGGER)) return // the trigger toggles itself
      closeRef.current()
    }
    const onWheel = (e: WheelEvent) => {
      if (p.sheet) return
      const t = e.target as Element | null
      if (t && el.contains(t)) return
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, { capture: true })
    addEventListener('wheel', onWheel, { passive: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, { capture: true })
      removeEventListener('wheel', onWheel)
    }
  }, [p.sheet])

  const panel = (
    <div
      ref={ref}
      className={`ui-pop${p.sheet ? ' ui-pop--sheet' : ''}${p.className ? ` ${p.className}` : ''}`}
      role={p.role ?? 'dialog'}
      aria-modal={p.sheet ? true : undefined}
      aria-label={p.label}
      tabIndex={-1}
      style={p.width ? { width: p.width } : undefined}
      onContextMenu={e => e.preventDefault()}
    >
      {p.children}
    </div>
  )
  return createPortal(
    p.sheet ? (
      <>
        <div className="ui-scrim" aria-hidden="true" onPointerDown={() => closeRef.current()} />
        {panel}
      </>
    ) : panel,
    document.body,
  )
}

/** Viewport rect of an element as the store's Rect (falls back to the top bar centre). */
export function rectOf(el: Element | null | undefined): Rect {
  if (!el) return { x: innerWidth / 2, y: 44, w: 0, h: 0 }
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}
/** A zero-size anchor at a pointer position (context menus). */
export const pointRect = (x: number, y: number): Rect => ({ x, y, w: 0, h: 0 })
