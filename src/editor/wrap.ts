/**
 * Text wrap = CSS floats + shape-outside (docs/specs/editor-engineering.md, with DESIGN §3
 * geometry: 16px pitch, MIN_COLUMN 9 cells). For a text block we compute at most two
 * non-editable float siblings (one per side) that precede the contenteditable in the same block
 * formatting context. Each float is the bounding box of the images on that side with a
 * `polygon(nonzero, …) border-box` staircase, margin baked in (shape-margin 0), so line boxes wrap
 * exactly around the image rects plus the wrap margin. Break is a full-width band; Behind/Front
 * never float. Auto picks the side with more room and degrades to Break under MIN_COLUMN.
 */
import { DEFAULT_WRAP_MARGIN, MIN_COLUMN, PAGE, PITCH, type FloatSpec, type Id, type ImageBlock, type TextBlock, type WrapMode } from '@/model/types'
import type { PxRect } from './snap'

/** Live px rects (block id → rect) that override committed geometry during a gesture. */
export type LiveRects = Map<Id, PxRect>

interface Span { y0: number; y1: number; ext: number }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Rotation-aware axis-aligned bounding box of an image block, in page px. */
export function aabb(img: Pick<ImageBlock, 'x' | 'y' | 'w' | 'h' | 'rotation'>): PxRect {
  const x = img.x * PITCH
  const y = img.y * PITCH
  const w = img.w * PITCH
  const h = img.h * PITCH
  const r = ((img.rotation ?? 0) * Math.PI) / 180
  if (!r) return { x, y, w, h }
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  const bw = w * c + h * s
  const bh = w * s + h * c
  return { x: x + w / 2 - bw / 2, y: y + h / 2 - bh / 2, w: bw, h: bh }
}
export function aabbOf(rect: PxRect, rotation = 0): PxRect {
  const r = (rotation * Math.PI) / 180
  if (!r) return rect
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  const bw = rect.w * c + rect.h * s
  const bh = rect.w * s + rect.h * c
  return { x: rect.x + rect.w / 2 - bw / 2, y: rect.y + rect.h / 2 - bh / 2, w: bw, h: bh }
}

/** An image as the wrap engine sees it (px rect already rotation-expanded). */
export interface WrapImage { rect: PxRect; wrapMode: WrapMode; margin: number }

/**
 * Px-level core. `T` is the text block's px rect (height unused); `textBottomPx` is the measured
 * bottom of the text run in page px when known (else the page bottom, so text placed above an
 * image starts wrapping the moment it grows into it).
 */
export function computeFloatsPx(T: { x: number; y: number; w: number }, images: WrapImage[], textBottomPx: number = PAGE.h): FloatSpec[] {
  const spans: Record<'left' | 'right', Span[]> = { left: [], right: [] }
  const bottom = Math.max(T.y + 1, textBottomPx)
  for (const img of images) {
    if (img.wrapMode === 'behind' || img.wrapMode === 'front') continue
    const m = img.margin
    const R = img.rect
    const x0 = R.x - m
    const x1 = R.x + R.w + m
    const y0 = R.y - m
    const y1 = R.y + R.h + m
    if (x1 <= T.x || x0 >= T.x + T.w) continue // no horizontal overlap
    if (y1 <= T.y || y0 >= bottom) continue // no vertical overlap with the text run
    const ly0 = Math.max(0, y0 - T.y)
    const ly1 = y1 - T.y
    const leftGap = x0 - T.x // room for text left of the image
    const rightGap = T.x + T.w - x1 // room right of the image
    let mode: WrapMode = img.wrapMode
    if (mode === 'auto') mode = Math.max(leftGap, rightGap) < MIN_COLUMN ? 'break' : leftGap >= rightGap ? 'right' : 'left'
    else if (mode === 'left' && rightGap < MIN_COLUMN) mode = 'break'
    else if (mode === 'right' && leftGap < MIN_COLUMN) mode = 'break'
    if (mode === 'break') spans.left.push({ y0: ly0, y1: ly1, ext: T.w })
    else if (mode === 'left') spans.left.push({ y0: ly0, y1: ly1, ext: clamp(x1 - T.x, 0, T.w) })
    else spans.right.push({ y0: ly0, y1: ly1, ext: clamp(T.x + T.w - x0, 0, T.w) })
  }
  const out: FloatSpec[] = []
  for (const side of ['left', 'right'] as const) {
    const s = spans[side]
    if (!s.length) continue
    const ys = [...new Set(s.flatMap(p => [r2(p.y0), r2(p.y1)]))].sort((a, b) => a - b)
    const bands: Span[] = []
    for (let i = 0; i < ys.length - 1; i++) {
      const y0 = ys[i]
      const y1 = ys[i + 1]
      if (y1 - y0 < 0.5) continue
      const ext = s.reduce((mx, p) => (p.y0 < y1 && p.y1 > y0 ? Math.max(mx, p.ext) : mx), 0)
      const last = bands[bands.length - 1]
      if (last && last.ext === ext) last.y1 = y1
      else bands.push({ y0, y1, ext })
    }
    if (!bands.length) continue
    const top = bands[0].y0
    const H = Math.max(1, r2(bands[bands.length - 1].y1 - top))
    const W = Math.max(1, r2(Math.max(...bands.map(b => b.ext))))
    const edge = side === 'left' ? 0 : W
    const sx = (ext: number) => r2(side === 'left' ? ext : W - ext)
    const pts = [`${edge}px 0px`]
    for (const b of bands) pts.push(`${sx(b.ext)}px ${r2(b.y0 - top)}px`, `${sx(b.ext)}px ${r2(b.y1 - top)}px`)
    pts.push(`${edge}px ${H}px`)
    out.push({ side, top: r2(top), width: W, height: H, polygon: `polygon(nonzero, ${pts.join(', ')}) border-box` })
  }
  return out
}
const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * What the renderer and the gesture loop both call: floats for `text` against `images`, with
 * optional live rect overrides (the block being dragged/resized) and the measured text height.
 */
export function floatsFor(text: TextBlock, images: ImageBlock[], textHeightPx?: number, live?: LiveRects): FloatSpec[] {
  const tr = live?.get(text.id)
  const T = tr ? { x: tr.x, y: tr.y, w: tr.w } : { x: text.x * PITCH, y: text.y * PITCH, w: text.w * PITCH }
  const bottom = textHeightPx && textHeightPx > 0 ? T.y + textHeightPx : PAGE.h
  const imgs: WrapImage[] = []
  for (const img of images) {
    if (img.wrapMode === 'behind' || img.wrapMode === 'front') continue
    const lr = live?.get(img.id)
    imgs.push({ rect: lr ? aabbOf(lr, img.rotation ?? 0) : aabb(img), wrapMode: img.wrapMode, margin: img.wrapMargin ?? DEFAULT_WRAP_MARGIN })
  }
  return computeFloatsPx(T, imgs, bottom)
}

/** Cache key for the React commit path (rerun the wrap effect only when one of these changes). */
export const imagesWrapKey = (images: ImageBlock[]) =>
  images.map(i => `${i.id}:${i.x},${i.y},${i.w},${i.h},${i.wrapMode},${i.wrapMargin ?? ''},${i.rotation ?? 0}`).join('|')

/** Block-level convenience: the spec's signature. */
export function computeFloats(text: TextBlock, images: ImageBlock[], textBottomPx: number = PAGE.h): FloatSpec[] {
  return computeFloatsPx(
    { x: text.x * PITCH, y: text.y * PITCH, w: text.w * PITCH },
    images.map(img => ({ rect: aabb(img), wrapMode: img.wrapMode, margin: img.wrapMargin ?? DEFAULT_WRAP_MARGIN })),
    textBottomPx,
  )
}

/**
 * Imperative writer used both by React (after commit) and the gesture rAF loop. Only changed
 * styles are written. Floats are kept in DOM order of ascending top (CSS forbids a later float
 * from sitting higher than an earlier one) and always precede the `.ed-text` editable.
 */
export function applyFloats(blockEl: HTMLElement, specs: FloatSpec[]): boolean {
  const body = blockEl.querySelector<HTMLElement>(':scope > .ed-text')
  if (!body) return false
  let changed = false
  const els: Partial<Record<'left' | 'right', HTMLElement>> = {}
  for (const side of ['left', 'right'] as const) {
    const spec = specs.find(f => f.side === side)
    let el = blockEl.querySelector<HTMLElement>(`:scope > .ed-float--${side}`)
    if (!spec) {
      if (el) { el.remove(); changed = true }
      continue
    }
    if (!el) {
      el = document.createElement('div')
      el.className = `ed-float ed-float--${side}`
      el.setAttribute('aria-hidden', 'true')
      el.setAttribute('contenteditable', 'false')
      blockEl.insertBefore(el, body) // MUST precede the editable, same BFC
      changed = true
    }
    els[side] = el
    const key = `${spec.top}|${spec.width}|${spec.height}|${spec.polygon}`
    if (el.dataset.key === key) continue
    el.dataset.key = key
    el.dataset.top = String(spec.top)
    el.style.marginTop = spec.top + 'px'
    el.style.width = spec.width + 'px'
    el.style.height = spec.height + 'px'
    el.style.shapeOutside = spec.polygon
    el.style.setProperty('--shape', spec.polygon.replace(/\)\s*border-box$/, ')'))
    changed = true
  }
  // order by top so neither float is pushed down by the other
  const L = els.left
  const R = els.right
  if (L && R) {
    const lTop = Number(L.dataset.top ?? 0)
    const rTop = Number(R.dataset.top ?? 0)
    const first = blockEl.firstElementChild
    if (rTop < lTop && first !== R) { blockEl.insertBefore(R, L); changed = true }
    else if (rTop >= lTop && first !== L) { blockEl.insertBefore(L, R); changed = true }
  }
  return changed
}
