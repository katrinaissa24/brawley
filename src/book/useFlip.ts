/**
 * Flip controller: owns every 3D variable on the sheets (--a and --ax on the sheet + its two shades
 * + the two cast elements of its slot, data-live, data-flipping), the page mesh of a turning sheet
 * and the closed-block thickness. JS-driven in rAF (drag mapping, spring landing, spring flip);
 * CSS derives the flat-sheet shading from --a. React never touches these.
 *
 * Paper, not plastic. Three things make a turn read as a sheet of paper rather than a hinged card:
 *   · it bends. A turning sheet becomes a mesh of vertical strips hinged edge to edge (`mesh.ts`)
 *     whose curve follows the sheet's own motion through an underdamped spring — so the body hangs
 *     from the finger that drags it, the fore-edge trails a flick, and the page slaps down and
 *     settles after the gutter has landed. --a is the gutter's angle; the cast shadow beneath
 *     follows the chord to the fore-edge instead, which is where the page actually is.
 *   · it carries momentum. Every flip is a spring, not a fixed tween: a flick throws the page and it
 *     lands hard, a slow drag sets it down slowly, and the release velocity decides which way it goes.
 *   · you can take it by the corner. Grabbing near the head or tail tilts the hinge axis (--ax) so
 *     that corner leads and the sheet folds diagonally; the tilt decays to zero by the end of the
 *     turn, because only a rotation about the gutter can leave the page lying flat.
 *
 * Spread model: cur = -1 means the book is closed (cover at 0deg); cur >= 0 is the visible spread.
 * A forward flip turns sheet `target` (the right page's sheet); a backward flip turns sheet `target - 1`.
 * `target` = the spread the book is heading to (cur + the in-flight commits), so stacked flips pick
 * the sheet beneath rather than the one already in the air. Drags never start while a sheet is in flight,
 * so a cancel is always the only flight and the geometry stays consistent.
 */
import { useMemo } from 'react'
import { MOTION } from '@/feel/motion'
import { sound } from '@/feel/sound'
import { SPRINGS, animateSpring, tween } from '@/feel/spring'
import { buildMesh, releaseMesh, writeMesh, type MeshRig } from './mesh'
import type { SheetEls } from './Sheet'

export type Dir = 1 | -1
export interface Unders { r: HTMLElement; l: HTMLElement }
interface Flight {
  k: number
  dir: Dir
  a: number
  slot: 1 | 2
  els: SheetEls
  unders: Unders
  silent: boolean
  gated: boolean // sounds on angle crossings (drags + springs)
  lifted: boolean
  landed: boolean
  cancel: (() => void) | null
  extra?: (a: number) => void
  /** the bending strips of this sheet, while it is in the air */
  rig: MeshRig | null
  /** where along the head-tail axis the sheet was taken: -1 head, 0 middle, +1 tail */
  grab: number
}
interface Drag { f: Flight; spineX: number; r: number; x0: number; y0: number; pointerId: number; samples: [number, number][] }
/** A mesh still settling on a sheet that has already landed (the flight is over; the paper is not). */
interface Settling { rig: MeshRig; a: number; dir: Dir; raf: number; t0: number }
/** The bow is at rest below this, in degrees and degrees per second. */
const SETTLED_BOW = 0.35
const SETTLED_VEL = 4
const SETTLE_MAX_MS = 700

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const D2R = Math.PI / 180
/** How far a corner grab leans the hinge axis at the deepest point of the turn. */
const AXIS_TILT = 0.34
/** Velocity is read over this window, so a pause before letting go really does mean "let it down". */
const VELOCITY_WINDOW = 110 // ms

/**
 * A spring that covers its travel in about `ms`, at zeta 0.9 — near-critical, so it arrives with
 * weight but without a bounce that would drive the page through the block underneath.
 */
export function springFor(ms: number) {
  const w = 4 / ((Math.max(60, ms) / 1000) * 0.9)
  return { k: w * w, c: 2 * 0.9 * w }
}
export const easeOutQuintFn = (t: number) => 1 - Math.pow(1 - t, 5)
export const hasTrig = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('opacity', 'calc(sin(1deg))')

export class FlipController {
  sheets = new Map<number, SheetEls>()
  unders: [Unders | null, Unders | null] = [null, null]
  blocks: { left: HTMLElement | null; right: HTMLElement | null } = { left: null, right: null }
  book: HTMLElement | null = null
  /** current resting spread (-1 = closed) */
  cur = -1
  /** the spread the book is heading to (cur + in-flight commits) */
  target = -1
  maxSpread = 0
  sheetCount = 1
  inFlight: Flight[] = []
  private settling: Settling[] = []
  private queue: { dir: Dir; ms?: number; silent?: boolean }[] = []
  private waiters: (() => void)[] = []
  private drag: Drag | null = null
  private peek: { k: number; cancel: () => void } | null = null
  private wheelAcc = 0
  private wheelT = 0
  private wheelLast = 0
  /** React-side commit of the resting spread (navigate + remount window) */
  onCommit: (spread: number) => void = () => {}
  /** called at the start of a flip when MOTION.reduced (crossfade instead of a hinge) */
  onReducedFlip: () => void = () => {}

  /* ---------- writes ---------- */
  /** `a` is the gutter angle; `chord` the angle of the line from the gutter to the fore-edge, which the cast shadow follows. */
  private writeVars(els: SheetEls, unders: Unders | null, a: number, chord = a) {
    const s = a.toFixed(3) + 'deg'
    els.root.style.setProperty('--a', s)
    els.shadeF.style.setProperty('--a', s)
    els.shadeB.style.setProperty('--a', s)
    const cs = chord.toFixed(3) + 'deg'
    if (unders) { unders.r.style.setProperty('--a', cs); unders.l.style.setProperty('--a', cs) }
    if (!hasTrig) {
      const sn = -Math.sin(a * D2R)
      els.shadeF.style.setProperty('--shade-f', (sn * 0.8).toFixed(3))
      els.shadeB.style.setProperty('--shade-b', (sn * 0.7).toFixed(3))
      if (unders) {
        const o = (-Math.sin(chord * D2R)).toFixed(3), c = Math.cos(chord * D2R)
        unders.r.style.setProperty('--cast', o); unders.l.style.setProperty('--cast', o)
        unders.r.style.setProperty('--cast-r', Math.max(0, c).toFixed(3))
        unders.l.style.setProperty('--cast-l', Math.max(0, -c).toFixed(3))
      }
    }
  }
  private writeAngle(f: Flight, raw: number) {
    // the page lands against the block: the angle stops at the ends and the paper takes the energy
    const a = clamp(raw, -180, 0)
    f.a = a
    let chord = a
    if (f.rig) {
      const arc = writeMesh(f.rig, a, f.dir, performance.now())
      chord = a + f.rig.tip
      // a tilted hinge is only legal mid-turn: at either end nothing but a gutter rotation leaves
      // the sheet lying flat, so the tilt is scaled by the same arc as the bow
      if (f.grab) f.els.root.style.setProperty('--ax', (AXIS_TILT * f.grab * Math.sqrt(arc)).toFixed(4))
    }
    this.writeVars(f.els, f.unders, a, chord)
    f.extra?.(a)
    if (f.gated && !f.silent) {
      const p = f.dir === 1 ? -a : 180 + a // 0 at start .. 180 at the end of the turn
      if (!f.lifted && p > 15) { f.lifted = true; sound.pageLift() }
      else if (f.lifted && !f.landed && p < 15) { f.lifted = false; sound.pageLift(0.5) }
      if (!f.landed && p > 165) { f.landed = true; sound.pageLand() }
    }
  }
  private thick(n: number) { return Math.max(2, Math.min(26, 1.5 + n * 0.9)) }

  /** Put every sheet that is not in flight at rest for `cur`; live = cur-1, cur (+ flights and their unders). */
  syncRest() {
    const cur = this.cur
    const flying = new Set(this.inFlight.map(f => f.k))
    const live = new Set<number>([cur - 1, cur])
    for (const f of this.inFlight) { live.add(f.k); live.add(f.k - 1); live.add(f.k + 1) }
    if (this.peek) { live.add(this.peek.k); live.add(this.peek.k + 1); live.add(this.peek.k - 1) }
    for (const [k, els] of this.sheets) {
      if (!flying.has(k) && !(this.peek && this.peek.k === k)) this.writeVars(els, null, k < cur ? -180 : 0)
      if (live.has(k)) els.root.dataset.live = ''
      else delete els.root.dataset.live
    }
    if (!this.inFlight.length) for (const u of this.unders) if (u) this.writeVars({ root: u.r, shadeF: u.r, shadeB: u.l }, u, 0)
    const right = this.sheetCount - Math.max(0, cur)
    const left = Math.max(0, cur)
    this.blocks.right?.style.setProperty('--thick', this.thick(right).toFixed(2))
    this.blocks.left?.style.setProperty('--thick', this.thick(left).toFixed(2))
  }

  /* ---------- lifecycle ---------- */
  private canFlip(dir: Dir, from = this.target) {
    return dir === 1 ? from < this.maxSpread : from > 0
  }
  private beginFlip(dir: Dir, opts: { silent?: boolean; gated?: boolean; allowCover?: boolean; grab?: number; bend?: boolean } = {}): Flight | null {
    if (!opts.allowCover && !this.canFlip(dir)) return null
    const k = dir === 1 ? this.target : this.target - 1
    const els = this.sheets.get(k)
    if (!els) return null
    const slot: 1 | 2 = this.inFlight.length === 0 ? 1 : 2
    const unders = this.unders[slot - 1] ?? this.unders[0]
    if (!unders) return null
    let a = dir === 1 ? 0 : -180
    if (this.peek && this.peek.k === k) { this.peek.cancel(); a = this.peekAngle; this.peek = null }
    // the cover is a board and does not bend; reduced motion and the riffle (too fast to read, and
    // not worth a mesh per sheet) get the flat hinge too. A mesh still settling on this sheet from
    // its last landing is taken down first: the new one starts from flat.
    this.unsettle(els.root)
    const rig = k >= 0 && !MOTION.reduced && opts.bend !== false ? buildMesh(els.root) : null
    const f: Flight = {
      k, dir, a, slot, els, unders,
      silent: !!opts.silent, gated: !!opts.gated, lifted: false, landed: false, cancel: null,
      rig, grab: rig ? (opts.grab ?? 0) : 0,
    }
    if (rig) { rig.lastA = a; rig.lastT = 0 }
    els.root.dataset.flipping = String(slot)
    this.inFlight.push(f)
    this.target += dir
    this.syncRest()
    this.writeAngle(f, a)
    if (MOTION.reduced) this.onReducedFlip()
    return f
  }
  private endFlip(f: Flight, result: 'commit' | 'cancel') {
    f.cancel?.()
    f.cancel = null
    this.settle(f)
    delete f.els.root.dataset.flipping
    f.els.root.style.willChange = ''
    f.els.root.style.removeProperty('--ax')
    this.inFlight.splice(this.inFlight.indexOf(f), 1)
    if (result === 'commit') this.cur += f.dir
    else this.target -= f.dir
    if (!this.inFlight.length) this.target = this.cur
    this.syncRest()
    this.onCommit(this.cur)
    if (this.queue.length) {
      const q = this.queue.shift()!
      this.flip(q.dir, { ms: q.ms, silent: q.silent })
    }
    if (!this.inFlight.length && !this.queue.length) { const w = this.waiters; this.waiters = []; w.forEach(r => r()) }
  }
  private peekAngle = 0

  /* ---------- the paper outlives the turn: let the bow settle on the landed sheet ---------- */
  private settle(f: Flight) {
    const rig = f.rig
    f.rig = null
    if (!rig) return
    rig.held = false
    if (Math.abs(rig.bow) < SETTLED_BOW && Math.abs(rig.vel) < SETTLED_VEL) { releaseMesh(rig); return }
    const s: Settling = { rig, a: f.a, dir: f.dir, raf: 0, t0: performance.now() }
    const step = () => {
      const now = performance.now()
      writeMesh(rig, s.a, s.dir, now)
      const done = (Math.abs(rig.bow) < SETTLED_BOW && Math.abs(rig.vel) < SETTLED_VEL) || now - s.t0 > SETTLE_MAX_MS
      if (done) { s.raf = 0; this.unsettle(rig.sheet); return }
      s.raf = requestAnimationFrame(step)
    }
    s.raf = requestAnimationFrame(step)
    this.settling.push(s)
  }
  private unsettle(sheet?: HTMLElement) {
    for (let i = this.settling.length - 1; i >= 0; i--) {
      const s = this.settling[i]
      if (sheet && s.rig.sheet !== sheet) continue
      if (s.raf) cancelAnimationFrame(s.raf)
      releaseMesh(s.rig)
      this.settling.splice(i, 1)
    }
  }

  /**
   * Programmatic (click / key / silent) flip. A spring rather than a tween, with a push to start it:
   * the page accelerates off the block and decelerates onto the far side, so a nudged page and a
   * thrown page do not move identically. `ms` picks the stiffness rather than a fixed duration.
   */
  flip(dir: Dir, opts: { ms?: number; silent?: boolean; allowCover?: boolean; extra?: (a: number) => void } = {}): boolean {
    if (this.drag) return false
    if (!opts.allowCover && !this.canFlip(dir)) return false
    if (this.inFlight.length >= 2) { this.queue.push({ dir, ms: opts.ms, silent: opts.silent }); return true }
    const ms = opts.ms ?? 520
    const f = this.beginFlip(dir, { silent: opts.silent, allowCover: opts.allowCover, bend: ms > 160 })
    if (!f) return false
    f.extra = opts.extra
    const to = dir === 1 ? -180 : 0
    if (!opts.silent) sound.pageLift()
    const from = f.a
    let landed = false
    f.cancel = animateSpring({
      from, to, v0: (to - from) * 1.2, spring: springFor(ms), epsilon: 0.05,
      onFrame: x => {
        this.writeAngle(f, x)
        const t = Math.abs(x - from) / Math.max(1, Math.abs(to - from))
        if (!landed && t >= 0.72) { landed = true; if (!opts.silent) sound.pageLand(1, Math.min(1.4, Math.max(0.6, ms / 520))) }
      },
      onDone: () => { if (!landed && !opts.silent) sound.pageLand(); this.endFlip(f, 'commit') },
    })
    return true
  }

  /** Open the cover (closed -> spread 0). `extra` receives the cover angle each frame (for --cover-a). */
  openCover(ms: number, extra: (a: number) => void): Promise<void> {
    if (this.cur >= 0) { extra(-180); return Promise.resolve() }
    const ok = this.flip(1, { ms, silent: true, allowCover: true, extra })
    if (!ok) { this.cur = this.target = 0; this.syncRest(); extra(-180); return Promise.resolve() }
    return this.settled()
  }

  /** Flip or jump to a spread. Resolves when at rest there. */
  flipTo(spread: number, opts: { ms?: number; silent?: boolean } = {}): Promise<void> {
    spread = clamp(spread, 0, this.maxSpread)
    if (this.drag) return this.settled()
    const from = this.target
    if (spread === from) return this.settled()
    if (Math.abs(spread - from) === 1 && from >= 0) {
      this.flip(spread > from ? 1 : -1, opts)
      return this.settled()
    }
    // jump silently
    if (this.inFlight.length) return this.settled().then(() => this.flipTo(spread, opts))
    this.cur = this.target = spread
    this.syncRest()
    this.onCommit(spread)
    return Promise.resolve()
  }
  /** Jump without animation (used by the riffle to skip the far part). */
  jump(spread: number) {
    spread = clamp(spread, -1, this.maxSpread)
    if (this.inFlight.length || this.drag) return
    this.cur = this.target = spread
    this.syncRest()
    this.onCommit(spread)
  }
  settled(): Promise<void> {
    if (!this.inFlight.length && !this.queue.length) return Promise.resolve()
    return new Promise(r => this.waiters.push(r))
  }

  /* ---------- hover peek ---------- */
  setPeek(dir: Dir, on: boolean) {
    if (this.inFlight.length || this.drag || MOTION.reduced) return
    const k = dir === 1 ? this.target : this.target - 1
    if (on && !this.canFlip(dir)) return
    if (this.peek && this.peek.k !== k) { this.peek.cancel(); this.peek = null }
    const els = this.sheets.get(k)
    if (!els) return
    const rest = dir === 1 ? 0 : -180
    const to = on ? rest + (dir === 1 ? -6 : 6) : rest
    this.peek?.cancel()
    const unders = this.unders[0]
    const p = { k, cancel: () => {} }
    this.peek = p
    this.syncRest()
    p.cancel = tween({
      from: this.peekAngle || rest, to, ms: 180, ease: easeOutQuintFn,
      onFrame: x => { this.peekAngle = x; this.writeVars(els, unders, x) },
      onDone: () => { if (!on) { if (this.peek === p) this.peek = null; this.peekAngle = 0; this.syncRest() } },
    })
  }

  /* ---------- drag (pointer capture on the scene; one layout read per gesture) ---------- */
  onPointerDown(e: PointerEvent, dir: Dir, scene: HTMLElement) {
    if (e.button !== 0 || this.drag || this.inFlight.length) return
    if (!this.canFlip(dir) || !this.book) return
    const rect = this.book.getBoundingClientRect()
    // where along the head-tail axis the page was taken: the outer thirds count as corners, and a
    // corner grab leans the hinge so that corner leads the fold
    const mid = rect.top + rect.height / 2
    const grab = clamp(((e.clientY - mid) / Math.max(1, rect.height / 2)) * 1.5, -1, 1)
    const f = this.beginFlip(dir, { gated: true, grab: Math.abs(grab) > 0.34 ? grab : 0 })
    if (!f) return
    scene.setPointerCapture(e.pointerId)
    if (f.rig) f.rig.held = true
    const spineX = rect.left
    const r = Math.max(40, Math.hypot(e.clientX - spineX, (e.clientY - mid) * 0.35))
    this.drag = { f, spineX, r, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, samples: [[e.timeStamp, f.a]] }
  }
  onPointerMove(e: PointerEvent) {
    const d = this.drag
    if (!d || e.pointerId !== d.pointerId) return
    const { f, spineX, r } = d
    const fwd = (x: number) => -Math.acos(clamp((x - spineX) / r, -1, 1)) / D2R
    const finger = f.dir === 1 ? fwd(e.clientX) : -180 - fwd(2 * spineX - e.clientX)
    // the finger holds the fore-edge; the gutter sits wherever the bowed page puts it
    this.writeAngle(f, finger - (f.rig?.tip ?? 0))
    d.samples.push([e.timeStamp, f.a])
    // keep a real time window rather than a fixed number of moves, so holding still reads as still
    while (d.samples.length > 2 && e.timeStamp - d.samples[0][0] > VELOCITY_WINDOW) d.samples.shift()
  }
  onPointerUp(e: PointerEvent, scene: HTMLElement) {
    const d = this.drag
    if (!d || e.pointerId !== d.pointerId) return
    this.drag = null
    try { scene.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    const { f, samples } = d
    if (f.rig) f.rig.held = false
    const [t0, a0] = samples[0]
    const [t1, a1] = samples[samples.length - 1]
    // a pause before release ages the sample out of the window and the page is simply set down
    const stale = e.timeStamp - t1 > VELOCITY_WINDOW
    const v = !stale && t1 > t0 ? ((a1 - a0) / (t1 - t0)) * 1000 : 0 // deg/s
    const end = f.dir === 1 ? -180 : 0
    const rest = f.dir === 1 ? 0 : -180
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6 && Math.abs(f.a - rest) < 8) {
      // a plain click on the edge: spring it over from here
      f.gated = false
      let landed = false
      sound.pageLift()
      const from = f.a
      f.cancel = animateSpring({
        from, to: end, v0: (end - from) * 1.2, spring: springFor(520), epsilon: 0.05,
        onFrame: x => {
          this.writeAngle(f, x)
          const t = Math.abs(x - from) / Math.max(1, Math.abs(end - from))
          if (!landed && t >= 0.72) { landed = true; sound.pageLand() }
        },
        onDone: () => { if (!landed) sound.pageLand(); this.endFlip(f, 'commit') },
      })
      return
    }
    const progress = f.dir === 1 ? -f.a : 180 + f.a
    const toward = f.dir === 1 ? -v : v
    // past halfway it goes over unless you are pulling it back; a flick carries it from anywhere
    const commit = toward > 240 ? true : toward < -240 ? false : progress > 55
    const to = commit ? end : rest
    // the throw keeps its speed: a hard flick lands hard, a slow release is set down gently
    const fast = Math.min(1, Math.abs(v) / 900)
    const spring = commit
      ? { k: SPRINGS.flipLand.k * (1 + fast * 1.6), c: SPRINGS.flipLand.c * (1 + fast * 0.5) }
      : SPRINGS.gentle
    f.cancel = animateSpring({
      from: f.a, to, v0: v, spring, epsilon: 0.05,
      onFrame: x => this.writeAngle(f, x),
      onDone: () => this.endFlip(f, commit ? 'commit' : 'cancel'),
    })
  }
  get dragging() { return !!this.drag }

  /* ---------- two-finger horizontal wheel burst ---------- */
  onWheel(e: WheelEvent): boolean {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return false
    const now = e.timeStamp
    if (now - this.wheelT > 200) this.wheelAcc = 0
    this.wheelT = now
    this.wheelAcc += e.deltaX
    if (Math.abs(this.wheelAcc) > 60 && now - this.wheelLast > 500) {
      this.wheelLast = now
      const dir: Dir = this.wheelAcc > 0 ? 1 : -1
      this.wheelAcc = 0
      this.flip(dir)
    }
    return true
  }

  dispose() {
    for (const f of this.inFlight) { f.cancel?.(); releaseMesh(f.rig); f.rig = null }
    this.inFlight = []
    this.unsettle()
    this.queue = []
    this.peek?.cancel()
    this.peek = null
    this.drag = null
    const w = this.waiters
    this.waiters = []
    w.forEach(r => r())
  }
}

export function useFlipController() {
  return useMemo(() => new FlipController(), [])
}
