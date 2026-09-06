/**
 * The page mesh — a turning sheet as a strip of vertices that bends like paper.
 *
 * Paper does not stretch and bends about one axis at a time, so a turning page is a developable
 * surface: a curve in the plane of the book (top view), extruded over the page's height. This
 * models it as a chain of N vertical strips hinged edge to edge from the gutter to the fore-edge —
 * a polyline of N+1 vertices — each strip carrying its own slice of the recto and the verso. Every
 * vertex has its own tangent, so the sheet curves differently at every point across its width, and
 * because each strip starts where the previous one ends the arc length is always exactly the page
 * width: the paper never stretches, whatever shape it takes.
 *
 * Shape. The tangent angle along the page is B·A(u) + S·G(u), u being the distance from the gutter
 * (0..1) and the two profiles two ways a sheet can bend:
 *   · A, the bow — the fore-edge leans B degrees away from the gutter's tangent, and the chord from
 *     the gutter to the fore-edge leans with it. This is the mode that decides how much of a turn
 *     is bend and how much is rotation. A is the integral of a curvature crest that is zero at
 *     both ends (the binding is a pin, the fore-edge is free, neither carries a bending moment)
 *     and peaks at u*, so A(0) = 0 and A(1) = 1.
 *   · H, the hang — the shape a span takes when it is loaded between two held ends: H(0) = -1,
 *     H(1) = +1, zero curvature at both ends, and — this is the point — mean zero, so it bellies
 *     the middle of the page without moving the fore-edge off the chord the bow put it on. It is
 *     the shape that puts an inflection in the page, and it is the difference between paper and a
 *     curved plate.
 * Two signs run through everything below: a positive bow leans the fore-edge back the way the page
 * came from, and a positive hang bellies the page away from the block it is leaning over.
 * The crest u* is not fixed: it starts out near the fore-edge, where a page first peels off the
 * block, and travels back to the gutter by the end of the turn, where the page unrolls onto the
 * far side. So the sheet is not one shape scaled up and down — it changes shape as it goes.
 *
 * Dynamics. B and S each chase a target through their own underdamped spring, and what they chase
 * depends on where the page is being driven from:
 *   · in free flight the page is driven at the binding, so the fore-edge trails: it lags the turn
 *     and its own weight droops it toward the block it is passing over;
 *   · held by the fore-edge it is driven at the other end, and the block underneath still carries
 *     the rest of the sheet — so the paper leaves the binding at a shallower angle than the finger
 *     and curls up to meet it. That is a page peeling off the block, and on the way down it is the
 *     same thing mirrored: the binding lies down first and the fore-edge follows it.
 *   · either way gravity's bending load is cos(a) — full when the page lies over a block, nil when
 *     it stands upright — and it bellies the span toward whichever block is underneath;
 *   · a page that has been bound never comes off the block quite flat, so a little bend is always
 *     there for the rest to work on.
 * The targets fade out at the ends of the turn, where the sheet lies on the block. The block is
 * also a hard limit: no vertex may pass through the page beneath, so the whole shape is scaled back
 * until every vertex clears and the springs lose most of their energy when it bites — the slap of a
 * landing page. The rig outlives the turn for as long as the paper takes to settle.
 *
 * Light. Each vertex is lit by one light overhead and a little to the right (Lambert), plus the
 * shadow the gutter throws across the first half of a lifted page. Every strip carries a gradient
 * between the shade values at its two vertices, so the shading is continuous across the strip
 * seams and the bow reads in the light before the silhouette shows it.
 */
import { MOTION } from '@/feel/motion'

/** Strips across a page: one per ~30px, never fewer than 12 nor more than 20. */
const STRIP_PX = 30
const MIN_STRIPS = 12
const MAX_STRIPS = 20
/** The two springs: the bow is stiff and light, the sag a little slower. Both at zeta ~0.58 — one
    soft overshoot, the way a sheet settles. */
const K_BOW = 340
const C_BOW = 21
const K_SAG = 210
const C_SAG = 17
/** Where the curvature crest sits at the start and at the end of a turn, and how sharp it is. */
const PEAK_OUT = 0.70
const PEAK_IN = 0.30
const PEAK_EXP = 4
/** The sheet is free of both blocks once sin(pi p) passes this. */
const LIFT_KNEE = 0.5
/**
 * What drives each mode, in degrees: `trail*` per 100 deg/s of turn (a click flip peaks around
 * 550 deg/s, a flick higher; a drag is far slower), `grav*` at gravity's full bending load, `set`
 * the bend the binding leaves in the paper. The signs are the whole story: free, the fore-edge
 * trails the turn and droops (bow positive over the near block); held, the binding stays shallow
 * and the paper curls up to the finger (bow negative over the near block). Both belly toward the
 * block they lean over, which is a negative hang.
 */
const FREE = { trailBow: 4, trailSag: -1.2, gravBow: 10, gravSag: -6, set: 5 }
const HELD = { trailBow: -4, trailSag: -3.3, gravBow: -18, gravSag: -13, set: 0 }
/** How much of the hang's stiffness the page's own weight eats when it stands up (see below). */
const BUCKLE = 0.62
/** The belly the paper always carries, so the page is never a dead flat plate. */
const SET_SAG = -2.2
const MAX_BOW = 40
const MAX_SAG = 24
/** What the springs keep when the sheet lands against a block. */
const LANDING_KEEP = 0.2
/** The light: overhead, a little to the right; how dark a face turned edge-on to it gets, and how
    gently the darkening comes on (paper is matte and the room is bright: a page tilted a little
    stays white, only a page seen nearly edge-on goes grey). */
const LIGHT_X = 0.22
const LAMBERT = 0.46
const LAMBERT_CURVE = 1.4
/** The gutter shadow: its depth at the binding and how far across the page it reaches. */
const GUTTER_FRONT = 0.34
const GUTTER_BACK = 0.28
const GUTTER_REACH = 0.45
/** Content further than this (page px) from a strip's slice is left out of the strip's clone. */
const PRUNE_MARGIN = 40
/** How far a slice runs under its neighbour, px, so no seam can open between strips. */
const SEAM_LAP = 1

const D2R = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * The bow profile A(u) = int(0..u) k / int(0..1) k for a curvature crest k(u) = u^a (1-u)^b that
 * peaks at u* — zero at both ends, and its integral rises from 0 at the gutter to 1 at the
 * fore-edge, so B really is the fore-edge's lean. Rebuilt each frame, since u* travels.
 */
const QN = 48
const CUM = new Float64Array(QN + 1)
function crest(uStar: number) {
  const al = PEAK_EXP * uStar
  const be = PEAK_EXP * (1 - uStar)
  let acc = 0
  for (let i = 1; i <= QN; i++) {
    const u = (i - 0.5) / QN
    acc += Math.pow(u, al) * Math.pow(1 - u, be)
    CUM[i] = acc
  }
  const inv = acc > 0 ? 1 / acc : 0
  for (let i = 1; i <= QN; i++) CUM[i] *= inv
}
function bowAt(u: number): number {
  const x = clamp(u, 0, 1) * QN
  const i = Math.min(QN - 1, Math.floor(x))
  return CUM[i] + (CUM[i + 1] - CUM[i]) * (x - i)
}
/**
 * The hang profile: the slope of a span carrying a load between two held ends, normalised to +-1.
 * H(u) = 6u^2 - 4u^3 - 1 is the slope of a simply supported beam under its own weight — zero
 * curvature at both ends (nothing holds a moment there) and mean zero over the span, so it bellies
 * the middle without dragging the fore-edge off the chord.
 */
function hangAt(u: number): number {
  const x = clamp(u, 0, 1)
  return 6 * x * x - 4 * x * x * x - 1
}

interface Slice { front: HTMLElement; back: HTMLElement }

export interface MeshRig {
  sheet: HTMLElement
  root: HTMLElement
  strips: HTMLElement[]
  shades: Slice[]
  n: number
  /** page width and strip width, px */
  w: number
  sw: number
  /** the bow and hang profiles at the vertices (n+1) and at the strip midpoints (n) */
  A: Float64Array
  Am: Float64Array
  G: Float64Array
  Gm: Float64Array
  /** the vertex chain in the sheet's own frame (n+1), rebuilt every frame */
  X: Float64Array
  Z: Float64Array
  /** the bow (fore-edge lean, deg) and the hang (mid-page belly, deg), each with its velocity */
  bow: number
  vel: number
  sag: number
  svel: number
  /** the fore-edge's position angle relative to the gutter tangent, deg — where the tip actually is */
  tip: number
  /** true while a finger holds the fore-edge */
  held: boolean
  lastA: number
  lastT: number
}
/* ---------- building ---------- */

interface Extent { el: Element; x0: number; x1: number }

/** The horizontal reach of every block on a face, in page px, rotation included. */
function blockExtents(doc: Element): Extent[] {
  const out: Extent[] = []
  for (const el of doc.children) {
    const st = (el as HTMLElement).style
    const x = parseFloat(st.getPropertyValue('--x')) || 0
    const w = parseFloat(st.getPropertyValue('--w')) || (el as HTMLElement).offsetWidth
    const h = parseFloat(st.getPropertyValue('--h')) || (el as HTMLElement).offsetHeight
    const rot = (parseFloat(st.getPropertyValue('--rot')) || 0) * D2R
    const half = Math.abs((w / 2) * Math.cos(rot)) + Math.abs((h / 2) * Math.sin(rot))
    const cx = x + w / 2
    out.push({ el, x0: cx - half - PRUNE_MARGIN, x1: cx + half + PRUNE_MARGIN })
  }
  return out
}

/**
 * A copy of a face carrying only what the slice [x0, x1] (page px) can show: no shade, controls or
 * veil of its own, and none of the blocks that lie wholly outside the slice — so each strip lays
 * out a fraction of the page, not all of it, N times over.
 */
function cloneSlice(face: HTMLElement, extents: Extent[] | null, x0: number, x1: number, left: number, w: number, h: number) {
  const c = face.cloneNode(false) as HTMLElement
  c.classList.add('ob__pclone')
  c.removeAttribute('data-page')
  c.style.cssText = `inset:auto;left:${left.toFixed(2)}px;top:0;width:${w.toFixed(2)}px;height:${h.toFixed(2)}px`
  for (const child of Array.from(face.children)) {
    if (child.matches('.ob__shade, .ob__opt, .ob__veil')) continue
    if (child.classList.contains('ob__docwrap') && extents) {
      const wrap = child.cloneNode(false)
      const doc = child.firstElementChild
      if (doc) {
        const d = doc.cloneNode(false)
        for (const e of extents) if (e.x1 >= x0 && e.x0 <= x1) d.appendChild(e.el.cloneNode(true))
        wrap.appendChild(d)
      }
      c.appendChild(wrap)
    } else c.appendChild(child.cloneNode(true))
  }
  return c
}

function slice(side: 'front' | 'back', w: number, h: number, clone: HTMLElement) {
  const el = document.createElement('div')
  el.className = `ob__pslice -${side}`
  el.style.cssText = `width:${w.toFixed(2)}px;height:${h.toFixed(2)}px`
  el.appendChild(clone)
  const shade = document.createElement('div')
  shade.className = 'ob__pshade'
  el.appendChild(shade)
  return { el, shade }
}

/**
 * Build the mesh for a sheet about to turn. Returns null when the sheet cannot bend (the cover is a
 * board, not paper) or has not been laid out yet — callers then just turn it flat.
 */
export function buildMesh(sheet: HTMLElement): MeshRig | null {
  const front = sheet.querySelector<HTMLElement>(':scope > .ob__face.-front')
  const back = sheet.querySelector<HTMLElement>(':scope > .ob__face.-back')
  if (!front || !back) return null
  const w = sheet.offsetWidth
  const h = sheet.offsetHeight
  if (w < 8 || h < 8) return null
  const n = clamp(Math.round(w / STRIP_PX), MIN_STRIPS, MAX_STRIPS)
  const sw = w / n
  const docF = front.querySelector('.ob__docwrap > .ed-doc')
  const docB = back.querySelector('.ob__docwrap > .ed-doc')
  const extF = docF ? blockExtents(docF) : null
  const extB = docB ? blockExtents(docB) : null
  const pageW = docF || docB ? parseFloat(getComputedStyle(docF ?? docB!).width) || 816 : 816
  const scale = pageW / w

  const root = document.createElement('div')
  root.className = 'ob__mesh'
  const strips: HTMLElement[] = []
  const shades: Slice[] = []
  for (let i = 0; i < n; i++) {
    const x0 = i * sw
    // every slice but the last runs a pixel past its vertex under the next strip: two strips meeting
    // at a sub-pixel seam otherwise let a hairline of whatever is beneath show through
    const lap = i < n - 1 ? SEAM_LAP : 0
    const strip = document.createElement('div')
    strip.className = 'ob__strip'
    strip.style.cssText = `width:${sw.toFixed(2)}px;height:${h}px`
    // the recto slice shows sheet x in [x0, x0+sw]; the verso slice is turned about its own centre,
    // so its local left edge is this strip's outer edge and its clone is offset from the far side
    const f = slice('front', sw + lap, h, cloneSlice(front, extF, x0 * scale, (x0 + sw + lap) * scale, -x0, w, h))
    const bx0 = w - x0 - sw
    const b = slice('back', sw + lap, h, cloneSlice(back, extB, (bx0 - lap) * scale, (bx0 + sw) * scale, -(bx0 - lap), w, h))
    strip.appendChild(f.el)
    strip.appendChild(b.el)
    root.appendChild(strip)
    strips.push(strip)
    shades.push({ front: f.shade, back: b.shade })
  }

  // the hang profile never changes; the bow profile is rebuilt each frame, as its crest travels
  const A = new Float64Array(n + 1)
  const Am = new Float64Array(n)
  const G = new Float64Array(n + 1)
  const Gm = new Float64Array(n)
  for (let i = 0; i <= n; i++) G[i] = hangAt(i / n)
  for (let i = 0; i < n; i++) Gm[i] = hangAt((i + 0.5) / n)

  sheet.appendChild(root)
  sheet.dataset.mesh = ''
  return {
    sheet, root, strips, shades, n, w, sw,
    A, Am, G, Gm, X: new Float64Array(n + 1), Z: new Float64Array(n + 1),
    bow: 0, vel: 0, sag: 0, svel: 0, tip: 0, held: false, lastA: 0, lastT: 0,
  }
}

/** Take the mesh down and give the sheet its flat faces back. */
export function releaseMesh(rig: MeshRig | null) {
  if (!rig) return
  delete rig.sheet.dataset.mesh
  rig.root.remove()
}

/** True once the paper has stopped moving: both modes are back to flat and still. */
export function meshAtRest(rig: MeshRig, bowEps: number, velEps: number): boolean {
  return Math.abs(rig.bow) < bowEps && Math.abs(rig.vel) < velEps
    && Math.abs(rig.sag) < bowEps && Math.abs(rig.svel) < velEps
}

/* ---------- one frame ---------- */

/** Walk the hinge chain for a given bow and sag, filling the vertex positions. */
function chain(rig: MeshRig, bow: number, sag: number) {
  const { n, sw, Am, Gm, X, Z } = rig
  let x = 0
  let z = 0
  X[0] = 0
  Z[0] = 0
  for (let i = 0; i < n; i++) {
    const r = (bow * Am[i] + sag * Gm[i]) * D2R
    x += sw * Math.cos(r)
    z -= sw * Math.sin(r)
    X[i + 1] = x
    Z[i + 1] = z
  }
}

/** How far (deg) the worst vertex of the current chain has passed through a block. */
function through(rig: MeshRig, a: number): number {
  let over = 0
  for (let i = 1; i <= rig.n; i++) {
    const c = a + Math.atan2(-rig.Z[i], rig.X[i]) / D2R
    if (c > over) over = c
    else if (-180 - c > over) over = -180 - c
  }
  return over
}

/**
 * One frame. `a` is the sheet's gutter angle (0 flat right .. -180 flat left), `dir` the direction
 * of the turn, `now` the animation clock. Returns the arc factor (0 at either end of the turn, 1 in
 * the middle) for callers that scale other mid-turn effects by it.
 */
export function writeMesh(rig: MeshRig, a: number, dir: 1 | -1, now: number): number {
  // the sheet's own clock: MOTION.speed slows the paper down along with everything else
  const dt = (rig.lastT ? clamp((now - rig.lastT) / 1000, 0.001, 0.05) : 0.016) * MOTION.speed
  const p = clamp(dir === 1 ? -a / 180 : (180 + a) / 180, 0, 1)
  const arc = Math.sin(Math.PI * p)
  // how free the sheet is of the blocks: at either end of the turn it is lying on one of them, and
  // paper that is lying down neither trails nor sags
  const q = clamp(arc / LIFT_KNEE, 0, 1)
  const lift = q * q * (3 - 2 * q)

  // this instant's curvature crest, and the bow profile it integrates to
  crest(PEAK_OUT + (PEAK_IN - PEAK_OUT) * p)
  for (let i = 0; i <= rig.n; i++) rig.A[i] = bowAt(i / rig.n)
  for (let i = 0; i < rig.n; i++) rig.Am[i] = bowAt((i + 0.5) / rig.n)

  if (dt > 0) {
    // everything the sheet is doing, the far side of the paper does a moment later
    const trail = -((a - rig.lastA) / dt) * lift
    // gravity's bending load: full when the page lies over a block, nil when it stands upright
    const grav = Math.cos(a * D2R) * lift
    // the other half of the page's weight. Standing up, it presses along the span instead of
    // across it, and a limp strip in compression does not straighten — it buckles. So near
    // upright, where the bending load has gone, the sheet's own weight amplifies whatever bend is
    // already there instead, the way a leaned sheet of paper bellies out rather than standing
    // straight. That is why a turning page is never flatter than at the moment it passes vertical.
    const amp = 1 / (1 - BUCKLE * Math.abs(Math.sin(a * D2R)) * lift)
    const m = rig.held ? HELD : FREE
    const t = (trail / 100) * dir // + when the paper is lagging the turn, whichever way it turns
    const bowT = (t * m.trailBow + m.set * lift) * dir + m.gravBow * grav
    const sagT = ((t * m.trailSag + SET_SAG * lift) * dir + m.gravSag * grav) * amp
    rig.vel += (-K_BOW * (rig.bow - clamp(bowT, -MAX_BOW, MAX_BOW)) - C_BOW * rig.vel) * dt
    rig.bow += rig.vel * dt
    rig.svel += (-K_SAG * (rig.sag - clamp(sagT, -MAX_SAG, MAX_SAG)) - C_SAG * rig.svel) * dt
    rig.sag += rig.svel * dt
  }
  rig.lastA = a
  rig.lastT = now

  // the blocks are a hard limit: no vertex may pass through the pages beneath. Scale the whole
  // shape back until the worst one clears; hitting a block takes most of the springs' energy too
  chain(rig, rig.bow, rig.sag)
  if (through(rig, a) > 0) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2
      chain(rig, rig.bow * mid, rig.sag * mid)
      if (through(rig, a) > 0.02) hi = mid
      else lo = mid
    }
    rig.bow *= lo
    rig.sag *= lo
    rig.vel *= LANDING_KEEP
    rig.svel *= LANDING_KEEP
    chain(rig, rig.bow, rig.sag)
  }
  rig.tip = Math.atan2(-rig.Z[rig.n], rig.X[rig.n]) / D2R

  // each strip is laid down where the last one ended, turned by the tangent at its own middle
  const { n, X, Z, A, Am, G, Gm, bow, sag } = rig
  const sinA = -Math.sin(a * D2R) // how far the sheet is lifted off the block (0 flat, 1 upright)
  const shadeF = (u: number, deg: number) => shade(deg, 1, u, GUTTER_FRONT, sinA)
  const shadeB = (u: number, deg: number) => shade(deg, -1, u, GUTTER_BACK, sinA)
  let s0f = shadeF(0, a)
  let s0b = shadeB(0, a)
  for (let i = 0; i < n; i++) {
    const phi = bow * Am[i] + sag * Gm[i]
    rig.strips[i].style.transform = `translate3d(${X[i].toFixed(2)}px,0,${Z[i].toFixed(2)}px) rotateY(${phi.toFixed(3)}deg)`
    const u1 = (i + 1) / n
    const deg1 = a + bow * A[i + 1] + sag * G[i + 1]
    const s1f = shadeF(u1, deg1)
    const s1b = shadeB(u1, deg1)
    const { front, back } = rig.shades[i]
    front.style.setProperty('--s0', s0f.toFixed(3))
    front.style.setProperty('--s1', s1f.toFixed(3))
    back.style.setProperty('--s0', s0b.toFixed(3))
    back.style.setProperty('--s1', s1b.toFixed(3))
    s0f = s1f
    s0b = s1b
  }
  return arc
}

/**
 * How dark a point of the page is: its face's Lambert term against the light (a face turned
 * edge-on catches none) plus the gutter shadow, which fades across the first half of the page and
 * grows as the sheet lifts. `side` is +1 for the recto's normal, -1 for the verso's.
 */
function shade(deg: number, side: 1 | -1, u: number, gutter: number, lifted: number): number {
  const r = deg * D2R
  // the recto's normal is (sin a, cos a) in the plane; the verso's is its opposite. Light = (LIGHT_X, 1).
  const lambert = side * (LIGHT_X * Math.sin(r) + Math.cos(r))
  const dark = Math.pow(clamp(1 - lambert, 0, 1), LAMBERT_CURVE) * LAMBERT
  const crease = Math.max(0, 1 - u / GUTTER_REACH) * gutter * lifted
  return clamp(dark + crease, 0, 0.85)
}
