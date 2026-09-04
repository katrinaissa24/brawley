/**
 * GestureController — the zero-lag gesture loop for the page (DESIGN §1). One delegated
 * pointerdown on the page root; pointer capture; pointermove only records numbers; a single rAF
 * does the math and writes --x/--y/--w/--h (and --rot) on the block element + the selection
 * overlay, the alignment hairlines, the size badge and the dot-mask position; the store is
 * committed exactly once on pointerup (a drag is one undo step). Snapping is the hysteresis
 * magnet in snap.ts (5px in / 7px out, 0.35/frame ease while snapped; Alt disables; Shift
 * constrains the axis / frees the aspect / steps rotation). Text blocks move only via their grab
 * handle or their selected frame; a plain click in text places the caret and never reaches here.
 * Keyboard nudge / delete / duplicate / reorder live here too so PageEditor just forwards keys.
 */
import { animateSpring, SPRINGS } from '@/feel/spring'
import { dur, MOTION } from '@/feel/motion'
import { sound } from '@/feel/sound'
import { useStore } from '@/model/store'
import { CONTENT, MIN_BLOCK, MIN_TEXT_W, PITCH, type Block, type Id, type ImageBlock, type TextBlock } from '@/model/types'
import { S } from '@/copy/strings'
import { addBlock, cellFloorAt, duplicateBlock, newBodyAt, removeBlock, reorderBlock, textBlocks, updateBlock } from './ops'
import type { EditorSession, LiveRects } from './session'
import { clampCells, clampPosPx, guidesFrom, intersects, magnetStep, nearestGuide, newAxis, type AxisMagnet, type Guides, type PxRect } from './snap'
import type { Handle } from './SelectionOverlay'

type GHandle = Handle | 'move' | 'rotate'
interface Latest { cx: number; cy: number; shift: boolean; alt: boolean; t: number }
interface Gesture {
  mode: 'move' | 'resize' | 'rotate' | 'empty'
  id: Id | null
  block: Block | null
  el: HTMLElement | null
  handle: GHandle | null
  pointerId: number
  originCx: number
  originCy: number
  pageRect: DOMRect
  scale: number
  start: PxRect
  cur: PxRect
  prevCellRect: PxRect
  aspect: number | null
  mx: AxisMagnet
  my: AxisMagnet
  guides: Guides
  dragging: boolean
  startRot: number
  startAngle: number
  rot: number
  lastCell: { x: number; y: number; w: number; h: number }
  changed: boolean
}

const deg = (r: number) => (r * 180) / Math.PI
const prevent = (e: Event) => e.preventDefault()

export class GestureController {
  private g: Gesture | null = null
  private latest: Latest | null = null
  private prevSample: Latest | null = null
  private speed = 0
  private raf = 0
  private lastSnapAt = 0
  private settle: (() => void) | null = null

  constructor(private root: HTMLElement, private session: EditorSession) {
    root.addEventListener('pointerdown', this.onDown)
    root.addEventListener('pointermove', this.onMove)
    root.addEventListener('pointerup', this.onUp)
    root.addEventListener('pointercancel', this.onCancel)
    root.addEventListener('lostpointercapture', this.onLost)
    root.addEventListener('dragstart', prevent)
    root.addEventListener('dblclick', this.onDblClick)
  }
  dispose() {
    const r = this.root
    r.removeEventListener('pointerdown', this.onDown)
    r.removeEventListener('pointermove', this.onMove)
    r.removeEventListener('pointerup', this.onUp)
    r.removeEventListener('pointercancel', this.onCancel)
    r.removeEventListener('lostpointercapture', this.onLost)
    r.removeEventListener('dragstart', prevent)
    r.removeEventListener('dblclick', this.onDblClick)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.settle?.()
    this.g = null
  }

  get active() { return !!this.g?.dragging }

  /* ---------- pointer → page px ---------- */
  private pagePoint(cx: number, cy: number, g?: { pageRect: DOMRect; scale: number }) {
    const r = g?.pageRect ?? this.root.getBoundingClientRect()
    const s = g?.scale ?? Math.max(0.01, r.width / this.root.offsetWidth)
    return { x: (cx - r.left) / s, y: (cy - r.top) / s }
  }

  /* ---------- down ---------- */
  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.g) return
    const t = e.target as HTMLElement
    const handleEl = t.closest<HTMLElement>('[data-handle]')
    let id: string | undefined
    let handle: GHandle | null = null
    if (handleEl && this.root.contains(handleEl)) {
      id = handleEl.dataset.for ?? handleEl.closest<HTMLElement>('[data-id]')?.dataset.id
      handle = (handleEl.dataset.handle as GHandle) ?? 'move'
    } else {
      const blockEl = t.closest<HTMLElement>('.ed-block[data-id]')
      if (!blockEl || !this.root.contains(blockEl)) { this.beginEmpty(e); return }
      id = blockEl.dataset.id
      const b = id ? this.session.block(id) : undefined
      if (!b || b.type === 'text') return // a plain click in text places the caret
      handle = 'move'
    }
    const block = id ? this.session.block(id) : undefined
    const el = id ? this.session.els.get(id) : undefined
    if (!block || !el || !id) return
    // while a picture is being reframed, a drag inside it pans the picture (ImageBlock owns that
    // gesture); the resize handles still move the frame itself
    if (handle === 'move' && useStore.getState().croppingBlockId === id) return
    e.preventDefault()
    const st = useStore.getState()
    if (!(st.selection.length === 1 && st.selection[0] === id)) st.select([id])
    if (block.locked && handle !== 'move') return
    const pageRect = this.root.getBoundingClientRect()
    const scale = Math.max(0.01, pageRect.width / this.root.offsetWidth)
    const start = this.session.rectPx(block)
    const mode: Gesture['mode'] = handle === 'rotate' ? 'rotate' : handle === 'move' ? 'move' : 'resize'
    const p = this.pagePoint(e.clientX, e.clientY, { pageRect, scale })
    const cx = start.x + start.w / 2
    const cy = start.y + start.h / 2
    const others = (this.session.page()?.blocks ?? []).filter(b => b.id !== id).map(b => this.session.rectPx(b))
    let aspect: number | null = null
    if (block.type === 'image') aspect = block.naturalW / Math.max(1, block.naturalH)
    else if (block.type === 'sticker') aspect = start.w / Math.max(1, start.h)
    this.g = {
      mode, id, block, el, handle, pointerId: e.pointerId,
      originCx: e.clientX, originCy: e.clientY, pageRect, scale,
      start, cur: { ...start }, prevCellRect: { ...start }, aspect,
      mx: newAxis(mode === 'resize' ? (handle!.includes('w') ? start.x : start.x + start.w) : start.x),
      my: newAxis(mode === 'resize' ? (handle!.includes('n') ? start.y : start.y + start.h) : start.y),
      guides: guidesFrom(others),
      dragging: false,
      startRot: block.rotation ?? 0,
      startAngle: deg(Math.atan2(p.y - cy, p.x - cx)),
      rot: block.rotation ?? 0,
      lastCell: { x: Math.round(start.x / PITCH), y: Math.round(start.y / PITCH), w: Math.round(start.w / PITCH), h: Math.round(start.h / PITCH) },
      changed: false,
    }
    this.settle?.()
    this.settle = null
    this.latest = { cx: e.clientX, cy: e.clientY, shift: e.shiftKey, alt: e.altKey, t: e.timeStamp }
    this.prevSample = this.latest
    try { this.root.setPointerCapture(e.pointerId) } catch { /* fine */ }
  }

  private beginEmpty(e: PointerEvent) {
    // no preventDefault: a focused editable must blur; the doc root is user-select: none anyway
    const pageRect = this.root.getBoundingClientRect()
    this.g = {
      mode: 'empty', id: null, block: null, el: null, handle: null, pointerId: e.pointerId,
      originCx: e.clientX, originCy: e.clientY, pageRect, scale: 1,
      start: { x: 0, y: 0, w: 0, h: 0 }, cur: { x: 0, y: 0, w: 0, h: 0 }, prevCellRect: { x: 0, y: 0, w: 0, h: 0 }, aspect: null,
      mx: newAxis(0), my: newAxis(0), guides: { xs: [], ys: [] }, dragging: false,
      startRot: 0, startAngle: 0, rot: 0, lastCell: { x: 0, y: 0, w: 0, h: 0 }, changed: false,
    }
  }

  /* ---------- move (numbers only) ---------- */
  private onMove = (e: PointerEvent) => {
    if (!this.g) return
    if (this.g.mode === 'empty') {
      if (Math.hypot(e.clientX - this.g.originCx, e.clientY - this.g.originCy) > 4) this.g.dragging = true
      return
    }
    this.latest = { cx: e.clientX, cy: e.clientY, shift: e.shiftKey, alt: e.altKey, t: e.timeStamp }
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  /* ---------- the frame ---------- */
  private frame = () => {
    this.raf = 0
    const g = this.g
    const L = this.latest
    if (!g || !L || g.mode === 'empty') return
    const ps = this.prevSample
    if (ps && L.t > ps.t) this.speed = (Math.hypot(L.cx - ps.cx, L.cy - ps.cy) / (L.t - ps.t)) * 1000
    this.prevSample = L

    let dx = (L.cx - g.originCx) / g.scale
    let dy = (L.cy - g.originCy) / g.scale
    if (!g.dragging) {
      if (Math.hypot(L.cx - g.originCx, L.cy - g.originCy) < 4) return
      this.begin(g)
    }
    const snap = !L.alt && useStore.getState().settings.snapToGrid
    if (g.mode === 'move') {
      if (L.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      const rawX = g.start.x + dx
      const rawY = g.start.y + dy
      const gx = snap ? nearestGuide(g.guides.xs, rawX, g.start.w) : null
      const gy = snap ? nearestGuide(g.guides.ys, rawY, g.start.h) : null
      const rx = magnetStep(g.mx, rawX, { snap, guide: gx?.pos })
      const ry = magnetStep(g.my, rawY, { snap, guide: gy?.pos })
      const p = clampPosPx(rx.v, ry.v, g.cur.w, g.cur.h)
      g.cur.x = p.x
      g.cur.y = p.y
      this.hairline('x', !Number.isNaN(rx.dot) && gx && rx.dot === gx.pos ? gx.line : null)
      this.hairline('y', !Number.isNaN(ry.dot) && gy && gy.pos === ry.dot ? gy.line : null)
      this.write(g)
      const cx = Math.round(p.x / PITCH)
      const cy = Math.round(p.y / PITCH)
      if (cx !== g.lastCell.x || cy !== g.lastCell.y) {
        g.lastCell.x = cx
        g.lastCell.y = cy
        if (snap && (rx.crossed || ry.crossed)) this.click()
        this.reflow(g)
      }
    } else if (g.mode === 'resize') {
      this.resizeFrame(g, dx, dy, L, snap)
    } else {
      const p = this.pagePoint(L.cx, L.cy, g)
      const cx = g.start.x + g.start.w / 2
      const cy = g.start.y + g.start.h / 2
      let rot = g.startRot + deg(Math.atan2(p.y - cy, p.x - cx)) - g.startAngle
      rot = ((rot + 540) % 360) - 180
      if (L.shift) rot = Math.round(rot / 15) * 15
      else if (!L.alt) { const near = Math.round(rot / 15) * 15; if (Math.abs(rot - near) < 4) rot = near }
      const prevRot = g.rot
      g.rot = Math.round(rot * 10) / 10
      g.el!.style.setProperty('--rot', g.rot + 'deg')
      this.session.selEl?.style.setProperty('--rot', g.rot + 'deg')
      this.badge(g, S.editor.rotation(g.rot))
      if (Math.round(prevRot / 15) !== Math.round(g.rot / 15) && Math.abs(g.rot % 15) < 0.01) this.click()
    }
    // dots wake up around the pointer
    const pp = this.pagePoint(L.cx, L.cy, g)
    const page = this.session.pageEl
    if (page) { page.style.setProperty('--mx', pp.x + 'px'); page.style.setProperty('--my', pp.y + 'px') }
  }

  private resizeFrame(g: Gesture, dx: number, dy: number, L: Latest, snap: boolean) {
    const h = g.handle as Handle
    const s = g.start
    const text = g.block!.type === 'text'
    let left = s.x, top = s.y, right = s.x + s.w, bottom = s.y + s.h
    const movesX = h.includes('e') || h.includes('w')
    const movesY = h.includes('n') || h.includes('s')
    const lock = g.aspect !== null && h.length === 2 && !L.shift
    if (movesX) {
      const raw = h.includes('w') ? s.x + dx : s.x + s.w + dx
      const gx = snap ? nearestGuide(g.guides.xs, raw, 0) : null
      const r = magnetStep(g.mx, raw, { snap, guide: gx?.pos })
      if (h.includes('w')) left = r.v; else right = r.v
      this.hairline('x', !Number.isNaN(r.dot) && gx && r.dot === gx.pos ? gx.line : null)
    }
    if (movesY) {
      const raw = h.includes('n') ? s.y + dy : s.y + s.h + dy
      const gy = snap ? nearestGuide(g.guides.ys, raw, 0) : null
      const r = magnetStep(g.my, raw, { snap, guide: gy?.pos })
      if (h.includes('n')) top = r.v; else bottom = r.v
      this.hairline('y', !Number.isNaN(r.dot) && gy && r.dot === gy.pos ? gy.line : null)
    }
    const minW = (text ? MIN_TEXT_W : MIN_BLOCK) * PITCH
    const minH = MIN_BLOCK * PITCH
    if (lock) {
      const a = g.aspect!
      if (Math.abs(dx) >= Math.abs(dy)) {
        const w = Math.max(minW, right - left)
        const hh = Math.max(minH, w / a)
        if (h.includes('n')) top = bottom - hh; else bottom = top + hh
        if (h.includes('w')) left = right - w; else right = left + w
      } else {
        const hh = Math.max(minH, bottom - top)
        const w = Math.max(minW, hh * a)
        if (h.includes('w')) left = right - w; else right = left + w
        if (h.includes('n')) top = bottom - hh; else bottom = top + hh
      }
    }
    if (right - left < minW) { if (h.includes('w')) left = right - minW; else right = left + minW }
    if (bottom - top < minH) { if (h.includes('n')) top = bottom - minH; else bottom = top + minH }
    // clamp to the content area (the fixed edge never moves)
    left = Math.max(CONTENT.x, left)
    top = Math.max(CONTENT.y, top)
    right = Math.min(CONTENT.x + CONTENT.w, right)
    bottom = Math.min(CONTENT.y + CONTENT.h, bottom)
    if (lock) {
      // a clamp broke the aspect: shrink the free dimension back toward the fixed corner
      const a = g.aspect!
      const w = right - left, hh = bottom - top
      if (w / hh > a) { const nw = hh * a; if (h.includes('w')) left = right - nw; else right = left + nw }
      else { const nh = w / a; if (h.includes('n')) top = bottom - nh; else bottom = top + nh }
    }
    g.cur = { x: left, y: top, w: right - left, h: text ? (h === 's' ? bottom - top : g.cur.h) : bottom - top }
    this.write(g)
    this.badge(g, S.editor.size(Math.round(g.cur.w), Math.round(g.cur.h)))
    const cw = Math.round(g.cur.w / PITCH), ch = Math.round(g.cur.h / PITCH)
    const cx = Math.round(g.cur.x / PITCH), cy = Math.round(g.cur.y / PITCH)
    if (cw !== g.lastCell.w || ch !== g.lastCell.h || cx !== g.lastCell.x || cy !== g.lastCell.y) {
      g.lastCell = { x: cx, y: cy, w: cw, h: ch }
      if (snap) this.click()
      this.reflow(g)
    }
  }

  private begin(g: Gesture) {
    g.dragging = true
    this.session.flushAll()
    const a = document.activeElement as HTMLElement | null
    if (a && a.isContentEditable) a.blur()
    g.el!.classList.add('is-dragging')
    if (g.mode !== 'rotate') g.el!.classList.add('is-lifted')
    this.session.selEl?.classList.add('is-dragging')
    this.root.dataset.gesture = g.mode
    this.session.pageEl?.setAttribute('data-gesture', g.mode)
    this.session.gesture = true
    this.session.emit('gesture', true)
    if (g.mode === 'resize' || g.mode === 'rotate') window.setTimeout(() => { if (this.g === g) this.session.badgeEl?.setAttribute('data-on', '1') }, 60)
  }

  /* ---------- writes ---------- */
  private write(g: Gesture) {
    const el = g.el!.style
    const c = g.cur
    el.setProperty('--x', c.x + 'px')
    el.setProperty('--y', c.y + 'px')
    if (g.mode === 'resize') {
      el.setProperty('--w', c.w + 'px')
      if (g.block!.type === 'text') { if (g.handle === 's') el.setProperty('--minh', c.h + 'px') }
      else el.setProperty('--h', c.h + 'px')
    }
    const sel = this.session.selEl?.style
    if (sel) {
      sel.setProperty('--sx', c.x + 'px')
      sel.setProperty('--sy', c.y + 'px')
      sel.setProperty('--sw', c.w + 'px')
      sel.setProperty('--sh', c.h + 'px')
    }
  }
  private hairline(axis: 'x' | 'y', line: number | null) {
    const el = axis === 'x' ? this.session.guideX : this.session.guideY
    if (!el) return
    if (line === null) { if (el.dataset.on) delete el.dataset.on; return }
    el.style.setProperty('--g', line + 'px')
    el.dataset.on = '1'
  }
  private badge(g: Gesture, text: string) {
    const b = this.session.badgeEl
    if (!b) return
    if (b.textContent !== text) b.textContent = text
    b.style.setProperty('--bx', g.cur.x + g.cur.w + 'px')
    b.style.setProperty('--by', g.cur.y + g.cur.h + 'px')
  }
  private click() {
    const now = performance.now()
    if (this.speed >= 600 || now - this.lastSnapAt < 60) return
    this.lastSnapAt = now
    sound.snap()
  }
  /** Live wrap: recompute floats for the text blocks touched before or after this cell change. */
  private reflow(g: Gesture) {
    const page = this.session.page()
    if (!page) return
    const live: LiveRects = new Map([[g.id!, { ...g.cur }]])
    if (g.block!.type === 'text') {
      this.session.wrapFns.get(g.id!)?.(live)
    } else if (g.block!.type === 'image') {
      const pad = (g.block as ImageBlock).wrapMargin ?? 16
      const grow = (r: PxRect): PxRect => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 })
      const a = grow(g.prevCellRect)
      const b = grow(g.cur)
      for (const t of textBlocks(page.blocks)) {
        const tr = this.session.rectPx(t)
        if (intersects(tr, a) || intersects(tr, b)) this.session.wrapFns.get(t.id)?.(live)
      }
    }
    g.prevCellRect = { ...g.cur }
  }

  /* ---------- up / cancel ---------- */
  private onUp = (e: PointerEvent) => {
    const g = this.g
    if (!g || e.pointerId !== g.pointerId) return
    if (g.mode === 'empty') {
      this.g = null
      if (!g.dragging) {
        const t = e.target as HTMLElement
        if (!t.closest('.ed-block, .ed-sel, [data-handle]')) useStore.getState().select([])
      }
      return
    }
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; this.frame() }
    const wasDragging = g.dragging
    this.teardown(g)
    if (!wasDragging) return
    if (g.mode === 'rotate') {
      const rotation = Math.abs(g.rot) < 0.05 ? undefined : g.rot
      if (rotation !== (g.block!.rotation ?? undefined)) this.commitPatch(g, { rotation })
      return
    }
    const b = g.block!
    let x: number, y: number, w: number, h: number
    if (g.mode === 'move') {
      x = Math.round(g.cur.x / PITCH)
      y = Math.round(g.cur.y / PITCH)
      w = b.type === 'text' ? b.w : b.w
      h = b.type === 'text' ? Math.round(g.cur.h / PITCH) : b.h
    } else {
      const left = Math.round(g.cur.x / PITCH)
      const top = Math.round(g.cur.y / PITCH)
      let right = Math.round((g.cur.x + g.cur.w) / PITCH)
      let bottom = Math.round((g.cur.y + g.cur.h) / PITCH)
      const minW = b.type === 'text' ? MIN_TEXT_W : MIN_BLOCK
      if (right - left < minW) right = left + minW
      if (bottom - top < MIN_BLOCK) bottom = top + MIN_BLOCK
      x = left; y = top; w = right - left; h = bottom - top
      if (g.aspect !== null && (g.handle as string).length === 2 && !this.latest?.shift) {
        // keep the committed frame on the natural aspect, anchored at the fixed corner
        const hh = Math.max(MIN_BLOCK, Math.round(w / g.aspect))
        if ((g.handle as string).includes('n')) y = bottom - hh
        h = hh
      }
    }
    const r = clampCells({ x, y, w, h }, b.type === 'text' ? MIN_TEXT_W : MIN_BLOCK, b.type === 'text' ? 1 : MIN_BLOCK)
    // write the exact committed px so the DOM and React agree before the render
    g.cur = { x: r.x * PITCH, y: r.y * PITCH, w: r.w * PITCH, h: b.type === 'text' && g.handle !== 's' ? g.cur.h : r.h * PITCH }
    this.write(g)
    if (b.type === 'text') {
      const patch: Partial<TextBlock> = { x: r.x, y: r.y, w: r.w }
      if (g.handle === 's') patch.minH = Math.max(2, r.h)
      if (patch.x !== b.x || patch.y !== b.y || patch.w !== b.w || (g.handle === 's' && patch.minH !== b.minH)) this.commitPatch(g, patch)
    } else {
      if (r.x !== b.x || r.y !== b.y || r.w !== b.w || r.h !== b.h) this.commitPatch(g, { x: r.x, y: r.y, w: r.w, h: r.h })
    }
    this.session.wrapFns.get(g.id!)?.()
    // drop settle: 1.015 → 1 on the snappy spring
    const el = g.el!
    if (!MOTION.reduced) {
      this.settle = animateSpring({
        from: 1.015, to: 1, spring: SPRINGS.snappy,
        onFrame: v => el.style.setProperty('--ed-lift', v.toFixed(4)),
        onDone: () => { el.style.removeProperty('--ed-lift'); this.settle = null },
      })
    }
  }
  private commitPatch(g: Gesture, patch: Partial<Block>) {
    const id = g.id!
    const pi = this.session.pageIndex
    this.session.commit(e => updateBlock(e, pi, id, b => ({ ...b, ...patch }) as Block))
  }
  private onCancel = (e: PointerEvent) => {
    const g = this.g
    if (!g || e.pointerId !== g.pointerId) return
    this.restore(g)
  }
  private onLost = (e: PointerEvent) => {
    const g = this.g
    if (!g || e.pointerId !== g.pointerId || g.mode === 'empty') return
    // capture lost without a pointerup (e.g. the window lost focus): put things back
    this.restore(g)
  }
  private restore(g: Gesture) {
    if (g.mode !== 'empty' && g.dragging) {
      g.cur = { ...g.start }
      g.rot = g.startRot
      this.write(g)
      g.el!.style.setProperty('--rot', g.startRot + 'deg')
      this.session.selEl?.style.setProperty('--rot', g.startRot + 'deg')
      this.reflow(g)
    }
    this.teardown(g)
  }
  private teardown(g: Gesture) {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0 }
    try { this.root.releasePointerCapture(g.pointerId) } catch { /* fine */ }
    this.g = null
    this.latest = null
    this.prevSample = null
    if (g.mode === 'empty') return
    g.el?.classList.remove('is-dragging', 'is-lifted')
    this.session.selEl?.classList.remove('is-dragging')
    delete this.root.dataset.gesture
    this.session.pageEl?.removeAttribute('data-gesture')
    this.hairline('x', null)
    this.hairline('y', null)
    const badge = this.session.badgeEl
    if (badge?.dataset.on) window.setTimeout(() => badge.removeAttribute('data-on'), 300)
    if (g.dragging) {
      this.session.gesture = false
      this.session.emit('gesture', false)
    }
  }

  /* ---------- double-click: empty paper → body block; picture → replace ---------- */
  private onDblClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement
    const blockEl = t.closest<HTMLElement>('.ed-block[data-id]')
    if (blockEl && this.root.contains(blockEl)) {
      if (blockEl.dataset.type === 'image') this.session.emit('replace', blockEl.dataset.id)
      return
    }
    if (t.closest('.ed-sel, [data-handle]')) return
    const p = this.pagePoint(e.clientX, e.clientY)
    const c = cellFloorAt(p.x, p.y)
    const nb = newBodyAt(c.x, c.y)
    this.session.justAdded.add(nb.id)
    this.session.commit(en => addBlock(en, this.session.pageIndex, nb))
    this.session.focus(nb.id, 'start')
  }

  /* ---------- keyboard ops (PageEditor forwards) ---------- */
  nudge(dx: number, dy: number, big: boolean) {
    const st = useStore.getState()
    const ids = st.selection
    if (!ids.length) return
    const step = big ? 4 : 1
    const pi = this.session.pageIndex
    let moved = false
    this.session.commit(e => {
      let out = e
      for (const id of ids) {
        const b = this.session.block(id)
        if (!b || b.locked) continue
        const r = this.session.rectPx(b)
        const c = clampCells({ x: b.x + dx * step, y: b.y + dy * step, w: b.w, h: Math.max(1, Math.round(r.h / PITCH)) }, b.type === 'text' ? MIN_TEXT_W : MIN_BLOCK, 1)
        if (c.x === b.x && c.y === b.y) continue
        moved = true
        out = updateBlock(out, pi, id, { x: c.x, y: c.y })
      }
      return out
    }, { coalesce: 'nudge:' + ids.join(',') })
    if (moved) sound.snap()
  }
  remove(ids: Id[]) {
    const pi = this.session.pageIndex
    const page = this.session.page()
    if (!page) return
    const gone = ids.map(id => ({ id, index: page.blocks.findIndex(b => b.id === id), block: page.blocks.find(b => b.id === id) })).filter(x => x.block)
    if (!gone.length) return
    for (const x of gone) this.session.els.get(x.id)?.classList.add('is-removing')
    const st = useStore.getState()
    st.select([])
    window.setTimeout(() => {
      this.session.commit(e => {
        let out = e
        for (const x of gone) out = removeBlock(out, pi, x.id)
        return out
      })
      sound.whump()
      const first = gone[0].block!
      const msg = gone.length > 1 ? S.editor.removed.text : first.type === 'image' ? S.editor.removed.image : first.type === 'sticker' ? S.editor.removed.sticker : S.editor.removed.text
      useStore.getState().toast(msg, {
        undo: () => {
          const s = this.session
          for (const x of gone) s.justAdded.add(x.id)
          s.commit(e => {
            const p = e.pages[pi]
            if (!p) return e
            const blocks = p.blocks.slice()
            for (const x of gone.slice().sort((a, b) => a.index - b.index)) {
              if (blocks.some(b => b.id === x.id)) continue
              blocks.splice(Math.min(x.index, blocks.length), 0, x.block!)
            }
            const pages = e.pages.slice()
            pages[pi] = { ...p, blocks }
            return { ...e, pages }
          })
          useStore.getState().select(gone.map(x => x.id))
        },
      })
    }, dur(160, 0))
  }
  duplicate(id: Id) {
    const pi = this.session.pageIndex
    const cur = this.session.entry()
    if (!cur) return
    const { entry, id: nid } = duplicateBlock(cur, pi, id)
    if (!nid) return
    this.session.justAdded.add(nid)
    useStore.getState().commitEntry(entry)
    useStore.getState().select([nid])
  }
  reorder(id: Id, dir: 1 | -1) {
    const pi = this.session.pageIndex
    this.session.commit(e => reorderBlock(e, pi, id, dir))
  }
}

