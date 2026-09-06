/**
 * Shelf layout: pure geometry from the ordered entries. Recomputed only when entries change.
 * Content x runs from 0 (first book) to `width` (right edge of the ghost slot). The focus line
 * (viewport centre) sits at content x == base + scrollLeft (see scrollRange), so every consumer
 * works in content x and useShelfScroll owns the conversion.
 */
import { BOOK, spineWidth, type Entry, type Id } from '@/model/types'
import { monthKey, yearOf } from '@/lib/dates'

export const GHOST_W = 22
export const OVERSCAN = 260
export const PLANK_SEG = 1200
export const GHOST_ID = '__ghost'

export type Slot =
  | { kind: 'book'; id: Id; entry: Entry; x: number; w: number; cx: number; month: string }
  | { kind: 'ghost'; id: typeof GHOST_ID; x: number; w: number; cx: number; month: string }

export interface MonthMark { key: string; index: number; x: number; end: number }
export interface YearMark { year: string; index: number; x: number }

export interface ShelfLayout {
  slots: Slot[]
  /** slot start positions, length slots.length + 1 (last = width) */
  xs: Float64Array
  /** spine centres per slot */
  centers: Float64Array
  monthStart: Set<number>
  months: MonthMark[]
  years: YearMark[]
  width: number
  indexOf: Map<Id, number>
  /** index of the newest real book (-1 when empty) */
  newest: number
}

export function computeLayout(entries: Entry[]): ShelfLayout {
  const n = entries.length
  const slots: Slot[] = []
  const xs = new Float64Array(n + 2)
  const centers = new Float64Array(n + 1)
  const monthStart = new Set<number>()
  const months: MonthMark[] = []
  const years: YearMark[] = []
  const indexOf = new Map<Id, number>()
  let x = 0
  let prevMonth = ''
  let prevYear = ''
  for (let i = 0; i < n; i++) {
    const e = entries[i]
    const m = monthKey(e.date)
    const y = yearOf(e.date)
    if (prevMonth && m !== prevMonth) x += BOOK.monthGap - BOOK.gap
    if (m !== prevMonth) {
      monthStart.add(i)
      if (months.length) months[months.length - 1].end = x
      months.push({ key: m, index: i, x, end: x })
    }
    if (y !== prevYear) years.push({ year: y, index: i, x })
    const w = e.cover.thickness ?? spineWidth(e.stats.pages, e.stats.words)
    slots.push({ kind: 'book', id: e.id, entry: e, x, w, cx: x + w / 2, month: m })
    xs[i] = x
    centers[i] = x + w / 2
    indexOf.set(e.id, i)
    x += w + BOOK.gap
    prevMonth = m
    prevYear = y
  }
  if (months.length) months[months.length - 1].end = x
  // the ghost "New entry" slot, just right of the newest book
  slots.push({ kind: 'ghost', id: GHOST_ID, x, w: GHOST_W, cx: x + GHOST_W / 2, month: prevMonth })
  xs[n] = x
  centers[n] = x + GHOST_W / 2
  indexOf.set(GHOST_ID, n)
  x += GHOST_W
  xs[n + 1] = x
  return { slots, xs, centers, monthStart, months, years, width: x, indexOf, newest: n - 1 }
}

/** First index i with a[i] >= v (a ascending). */
export function lowerBound(a: Float64Array, v: number, hi = a.length): number {
  let lo = 0
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m] < v) lo = m + 1
    else hi = m
  }
  return lo
}

/** Slot whose centre is nearest to content x. */
export function nearestSlot(layout: ShelfLayout, x: number): number {
  const c = layout.centers
  const n = layout.slots.length
  if (n === 0) return -1
  const i = lowerBound(c, x, n)
  if (i <= 0) return 0
  if (i >= n) return n - 1
  return x - c[i - 1] <= c[i] - x ? i - 1 : i
}

/** Month containing content x (by the month's [x, end) span); falls back to the nearest. */
export function monthAt(layout: ShelfLayout, x: number): MonthMark | null {
  const ms = layout.months
  if (!ms.length) return null
  let best = ms[0]
  for (const m of ms) if (m.x <= x) best = m
  return best
}

/** Index into layout.months of the month that contains slot i (-1 when there are no months). */
export function monthIndexOf(layout: ShelfLayout, i: number): number {
  const ms = layout.months
  let k = -1
  for (let j = 0; j < ms.length; j++) if (ms[j].index <= i) k = j
  return k
}

/** Small deterministic jitter in [-1, 1] from an id (so the row reads as hand-placed). */
export function jitter(id: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 2000) / 1000 - 1
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/* ---------- scroll range ----------
 * The row is the whole world: there is nothing to see left of the first book or right of the
 * ghost slot, so the scroller is only ever allowed to travel far enough to bring both ends to
 * within EDGE_PAD of the viewport edge. A row that already fits sits centred and does not scroll
 * at all — which is why a handful of books have no left/right travel to give away.
 *
 * `base` is the content x that sits on the focus line (the viewport centre) at scrollLeft 0, so
 * content x == base + scrollLeft; `travel` is the scroller's whole range (its --row-w).
 */
export const EDGE_PAD = 120

export interface ShelfRange {
  /** content x on the focus line at scrollLeft 0 */
  base: number
  /** scrollable travel in px (0 = the row fits and never scrolls) */
  travel: number
}

export function scrollRange(contentW: number, vw: number): ShelfRange {
  if (vw <= 0) return { base: contentW / 2, travel: 0 }
  const pad = Math.min(EDGE_PAD, vw * 0.12)
  const travel = contentW + pad * 2 - vw
  if (travel <= 0) return { base: contentW / 2, travel: 0 }
  return { base: vw / 2 - pad, travel }
}
