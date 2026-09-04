/**
 * Magnetic snap with hysteresis (docs/specs/motion-feel.md): the raw pointer position is passed
 * through a per-axis magnet that enters "snapped" within 5px of a dot and leaves only beyond 7px,
 * easing toward the dot at 0.35/frame while snapped and following the raw value exactly otherwise.
 * Alignment guides within 6px widen the magnet to 6 in / 9 out on that axis. Values are page px.
 * Also: content-area clamps in cells and px.
 */
import { CONTENT, MIN_BLOCK, MIN_TEXT_W, PAGE, PAGE_MARGIN, PITCH } from '@/model/types'

export interface AxisMagnet {
  /** eased, written position */
  v: number
  /** last snapped dot (NaN while unsnapped) */
  dot: number
  snapped: boolean
}
export const newAxis = (v: number): AxisMagnet => ({ v, dot: NaN, snapped: false })

export interface MagnetResult {
  /** value to write this frame */
  v: number
  /** true when the snapped dot changed this frame (→ detent + wrap reflow) */
  crossed: boolean
  /** the dot currently attracting, or NaN */
  dot: number
}

/**
 * One axis, one frame. `raw` = start + delta. `guide` (optional) is a guide line (px) the value
 * should prefer over the nearest grid dot when within 6px. `ease` is 0.35 (spec) or 1 for instant.
 */
export function magnetStep(m: AxisMagnet, raw: number, opts: { snap: boolean; guide?: number; ease?: number }): MagnetResult {
  const ease = opts.ease ?? 0.35
  if (!opts.snap) {
    m.snapped = false
    m.dot = NaN
    m.v = raw
    return { v: raw, crossed: false, dot: NaN }
  }
  let target = Math.round(raw / PITCH) * PITCH
  let inR = 5
  let outR = 7
  if (opts.guide !== undefined && Math.abs(raw - opts.guide) <= 6) {
    target = opts.guide
    inR = 6
    outR = 9
  }
  const d = Math.abs(raw - target)
  if (!m.snapped && d < inR) m.snapped = true
  else if (m.snapped && d > outR) m.snapped = false
  let crossed = false
  if (m.snapped) {
    if (target !== m.dot) { crossed = !Number.isNaN(m.dot) || true; m.dot = target }
    m.v += (target - m.v) * ease
    if (Math.abs(target - m.v) < 0.05) m.v = target
  } else {
    m.dot = NaN
    m.v = raw
  }
  return { v: m.v, crossed, dot: m.dot }
}

/* ---------- clamps ---------- */

export const CONTENT_MIN_X = PAGE_MARGIN
export const CONTENT_MIN_Y = PAGE_MARGIN
export const CONTENT_MAX_X = PAGE.cols - PAGE_MARGIN // exclusive right edge in cells (48)
export const CONTENT_MAX_Y = PAGE.rows - PAGE_MARGIN // exclusive bottom edge in cells (69)

export interface CellRect { x: number; y: number; w: number; h: number }
export interface PxRect { x: number; y: number; w: number; h: number }

/** Clamp a cell rect (position + size) to the content area. `minW/minH` in cells. */
export function clampCells(r: CellRect, minW = MIN_BLOCK, minH = MIN_BLOCK): CellRect {
  const maxW = CONTENT.cols
  const maxH = CONTENT.rows
  const w = Math.max(minW, Math.min(Math.round(r.w), maxW))
  const h = Math.max(minH, Math.min(Math.round(r.h), maxH))
  const x = Math.min(Math.max(Math.round(r.x), CONTENT_MIN_X), CONTENT_MAX_X - w)
  const y = Math.min(Math.max(Math.round(r.y), CONTENT_MIN_Y), CONTENT_MAX_Y - h)
  return { x, y, w, h }
}

/** Clamp a px position so a `w × h` px box stays inside the content area. */
export function clampPosPx(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const maxX = Math.max(CONTENT.x, CONTENT.x + CONTENT.w - w)
  const maxY = Math.max(CONTENT.y, CONTENT.y + CONTENT.h - h)
  return { x: Math.min(Math.max(x, CONTENT.x), maxX), y: Math.min(Math.max(y, CONTENT.y), maxY) }
}

export const minWidthCells = (type: 'text' | 'image' | 'sticker') => (type === 'text' ? MIN_TEXT_W : MIN_BLOCK)

export const toPx = (r: CellRect): PxRect => ({ x: r.x * PITCH, y: r.y * PITCH, w: r.w * PITCH, h: r.h * PITCH })
export const toCells = (r: PxRect): CellRect => ({
  x: Math.round(r.x / PITCH), y: Math.round(r.y / PITCH), w: Math.round(r.w / PITCH), h: Math.round(r.h / PITCH),
})
export const intersects = (a: PxRect, b: PxRect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * Alignment guides: candidate lines (px) from other blocks' edges/centres and the page margins.
 * Returned separately per axis; the magnet prefers the closest one within 6px.
 */
export interface Guides { xs: number[]; ys: number[] }
export function guidesFrom(others: PxRect[]): Guides {
  const xs = new Set<number>([CONTENT.x, CONTENT.x + CONTENT.w, CONTENT.x + CONTENT.w / 2])
  const ys = new Set<number>([CONTENT.y, CONTENT.y + CONTENT.h, CONTENT.y + CONTENT.h / 2])
  for (const r of others) {
    xs.add(r.x); xs.add(r.x + r.w); xs.add(r.x + r.w / 2)
    ys.add(r.y); ys.add(r.y + r.h); ys.add(r.y + r.h / 2)
  }
  return { xs: [...xs], ys: [...ys] }
}
/**
 * For a moving box at (x, y, w, h): find a guide line within `tol` of its left/centre/right (or
 * top/centre/bottom) and return the box position that aligns to it plus the guide line itself.
 */
export function nearestGuide(lines: number[], pos: number, size: number, tol = 6): { pos: number; line: number } | null {
  let best: { pos: number; line: number; d: number } | null = null
  for (const line of lines) {
    for (const off of [0, size / 2, size]) {
      const d = Math.abs(pos + off - line)
      if (d <= tol && (!best || d < best.d)) best = { pos: line - off, line, d }
    }
  }
  return best ? { pos: best.pos, line: best.line } : null
}
