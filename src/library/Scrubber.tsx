/**
 * Scrubber — the 3px hairline timeline along the bottom. One tick per month (taller at years, with
 * a muted year label), a 14px thumb that tracks scroll (written per frame through the handle, never
 * via state), drag-to-jump with soft month detents, click-to-animate. Hidden until the pointer nears
 * the bottom 96px or the shelf is scrolling. Terracotta dots mark months containing search matches.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type CSSProperties } from 'react'
import { monthLabel } from '@/lib/dates'
import { S } from '@/copy/strings'
import { clamp, monthAt, type ShelfLayout } from './layout'

export interface ScrubberHandle {
  setProgress(x: number, width: number): void
  setActive(on: boolean): void
}
export interface ScrubberProps {
  layout: ShelfLayout
  matchMonths: Set<string> | null
  onSeek(x: number, mode: 'drag' | 'click'): void
  onDragState?(on: boolean): void
}

const NEAR = 96
const DETENT = 6

export const Scrubber = forwardRef<ScrubberHandle, ScrubberProps>(function Scrubber({ layout, matchMonths, onSeek, onDragState }, ref) {
  const root = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const lastMonth = useRef('')
  const drag = useRef<{ id: number; x0: number; left: number; w: number; moved: boolean } | null>(null)

  const width = Math.max(1, layout.width)
  const ticks = useMemo(() => layout.months.map(m => ({
    key: m.key,
    t: m.x / width,
    year: layout.years.some(y => y.x === m.x) ? m.key.slice(0, 4) : null,
    match: !!matchMonths?.has(m.key),
  })), [layout, matchMonths, width])

  useImperativeHandle(ref, () => ({
    setProgress(x, w) {
      const t = clamp(x / Math.max(1, w), 0, 1)
      if (thumb.current) thumb.current.style.left = `${(t * 100).toFixed(3)}%`
      const m = monthAt(layoutRef.current, x)
      const key = m?.key ?? ''
      if (key !== lastMonth.current) {
        lastMonth.current = key
        const label = key ? monthLabel(key) : ''
        root.current?.setAttribute('aria-valuetext', label)
        if (tip.current) tip.current.textContent = label
      }
    },
    setActive(on) {
      if (!root.current) return
      if (on) root.current.setAttribute('data-active', '')
      else root.current.removeAttribute('data-active')
    },
  }), [])

  // reveal when the pointer nears the bottom edge (attribute write only; no React)
  useEffect(() => {
    let near = false
    const onMove = (e: PointerEvent) => {
      const n = e.clientY > innerHeight - NEAR
      if (n === near) return
      near = n
      if (n) root.current?.setAttribute('data-near', '')
      else root.current?.removeAttribute('data-near')
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const seekAt = (clientX: number, mode: 'drag' | 'click') => {
    const d = drag.current
    const el = root.current
    if (!el) return
    const left = d ? d.left : el.getBoundingClientRect().left
    const w = d ? d.w : el.getBoundingClientRect().width
    let px = clamp(clientX - left, 0, w)
    if (mode === 'drag') {
      // soft month detents: the thumb resists for ~6px around each tick
      for (const m of layoutRef.current.months) {
        const tx = (m.x / Math.max(1, layoutRef.current.width)) * w
        if (Math.abs(px - tx) < DETENT) { px = tx; break }
      }
    }
    onSeek((px / Math.max(1, w)) * layoutRef.current.width, mode)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const r = root.current!.getBoundingClientRect()
    drag.current = { id: e.pointerId, x0: e.clientX, left: r.left, w: r.width, moved: false }
    root.current!.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return
    if (!d.moved) { d.moved = true; root.current?.setAttribute('data-drag', ''); onDragState?.(true) }
    seekAt(e.clientX, 'drag')
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (root.current?.hasPointerCapture(e.pointerId)) root.current.releasePointerCapture(e.pointerId)
    if (d.moved) { root.current?.removeAttribute('data-drag'); onDragState?.(false) }
    else if (e.type === 'pointerup') seekAt(e.clientX, 'click')
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const ms = layoutRef.current.months
    if (!ms.length) return
    let k = ms.findIndex(m => m.key === lastMonth.current)
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') k = Math.min(ms.length - 1, k + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') k = Math.max(0, k - 1)
    else if (e.key === 'Home') k = 0
    else if (e.key === 'End') k = ms.length - 1
    else return
    e.preventDefault()
    onSeek(ms[Math.max(0, k)].x, 'click')
  }

  return (
    <div
      ref={root}
      className="shelf__scrub"
      role="slider"
      tabIndex={layout.months.length ? 0 : -1}
      aria-label={S.shelf.a11y.scrubber}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="shelf__scrub__track" />
      {ticks.map(t => (
        <div
          key={t.key}
          className="shelf__scrub__tick"
          data-year={t.year ? '' : undefined}
          data-match={t.match || undefined}
          style={{ '--t': t.t } as CSSProperties}
        >
          {t.year && <span className="shelf__scrub__year">{t.year}</span>}
        </div>
      ))}
      <div className="shelf__scrub__thumb" ref={thumb}>
        <div className="shelf__scrub__tip" ref={tip} />
      </div>
    </div>
  )
})
