/**
 * The page mesh — a turning sheet as a strip of vertices that bends like paper.
 *
 * Paper does not stretch and bends about one axis at a time, so a turning page is a developable
 * surface: a fan of straight ruling lines drawn on the sheet, with the paper flat between them.
 * This models it as a chain of N strips hinged edge to edge along those rulings from the gutter to
 * the fore-edge — N+1 rulings — each strip carrying its own slice of the recto and the verso. Every
 * ruling has its own tangent, so the sheet curves differently at every point across its width, and
 * because each strip starts where the previous one ends the arc length is always exactly the page
 * width: the paper never stretches, whatever shape it takes.
 *
 * Attachment. A page is not pinned at a point — it is bound along a whole edge. Ruling 0 IS the
 * bound edge, and strip 0 hinges about it, so every point of the binding stays exactly where it is
 * for the whole turn no matter what the rest of the sheet does. Nothing else in the rig may move
 * it: the sheet's own turn is a rotation about that same line (`--a` about the gutter), and each
 * strip's frame is the previous strip's frame composed with a rotation about the ruling they share,
 * so the chain hangs off the binding rather than floating beside it.
 *
 * Rulings. Taken square on, a page bends about lines parallel to the binding — the fan is a set of
 * parallels and the fold runs straight up the page. Taken by a corner it bends about a fan that
 * meets at an apex out on the binding's own line: the paper furthest from that apex — the grabbed
 * corner — swings furthest, so the fold runs diagonally and that corner leads. Both cases keep
 * ruling 0 on the bound edge, which is the whole point: the fan is what a corner grab tilts, not
 * the hinge. The fan is a property of the sheet, fixed for the turn; it needs no unwinding at the
 * ends, because when the bend goes to zero the page lies flat whichever way its rulings run.
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
 * also a hard limit: no corner of any strip may pass through the page beneath, so the whole shape
 * is scaled back until every corner clears and the springs lose most of their energy when it bites
 * — the slap of a landing page. The rig outlives the turn for as long as the paper takes to settle.
 *
 * Light. Each ruling is lit by one light overhead and a little to the right (Lambert), plus the
 * shadow the gutter throws across the first half of a lifted page. Every strip carries a gradient
 * between the shade values at its two rulings — run across the strip, square to the rulings — so
 * the shading is continuous across the strip seams and the bow reads in the light before the
 * silhouette shows it.
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
/** How far a full corner grab leans the fore-edge's ruling off the binding, in degrees, and how
    close to the page the fan's apex may come — under a page height the rulings would crowd hard
    enough to cross inside the sheet, and paper does not fold along two lines at once. */
const FAN_DEG = 16
const FAN_MIN_APEX = 1.1
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
const px = (v: number) => v.toFixed(2)

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
  /** page width and height, and the strip width at the page's mid-height, px */
  w: number
  h: number
  sw: number
  /** the bow and hang profiles at the rulings (n+1) and at the strip midpoints (n) */
  A: Float64Array
  Am: Float64Array
  G: Float64Array
  Gm: Float64Array
  /** each ruling's direction in the flat sheet (n+1), x and y of a unit vector */
  DX: Float64Array
  DY: Float64Array
  /** each strip's frame, rebuilt every frame: a 3x3 rotation (row major) and a translation */
  R: Float64Array
  T: Float64Array
  /** each strip's four corners in the flat sheet (x, y), the shape it is clipped to */
  C: Float64Array
  /** where each strip's own box starts across the sheet, px */
  BX: Float64Array
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
 * out a fraction of the page, not all of it, N times over. The copy is a whole page, laid at
 * `left` inside its strip and then clipped to the strip's own wedge of it.
 */
function cloneSlice(face: HTMLElement, extents: Extent[] | null, x0: number, x1: number, left: number, w: number, h: number, clip: string) {
  const c = face.cloneNode(false) as HTMLElement
  c.classList.add('ob__pclone')
  c.removeAttribute('data-page')
  c.style.cssText = `inset:auto;left:${px(left)}px;top:0;width:${px(w)}px;height:${px(h)}px;clip-path:${clip}`
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

/**
 * One face of a strip: a page-sized clone and a page-sized shade, both clipped to the strip's wedge
 * and laid at `left` so that page coordinates line up inside the strip's own narrower box. The
 * shade's gradient runs square to the strip's rulings, from the shade at one to the shade at the
 * other, so a fanned strip shades along its fold and not across it.
 */
function slice(side: 'front' | 'back', bw: number, h: number, clone: HTMLElement, left: number, w: number, clip: string, gdir: number, p0: number, p1: number) {
  const el = document.createElement('div')
  el.className = `ob__pslice -${side}`
  el.style.cssText = `width:${px(bw)}px;height:${px(h)}px`
  el.appendChild(clone)
  const shade = document.createElement('div')
  shade.className = 'ob__pshade'
  shade.style.cssText = `inset:auto;left:${px(left)}px;top:0;width:${px(w)}px;height:${px(h)}px;`
    + `clip-path:${clip};--gdir:${gdir.toFixed(2)}deg;--p0:${(p0 * 100).toFixed(2)}%;--p1:${(p1 * 100).toFixed(2)}%`
  el.appendChild(shade)
  return { el, shade }
}

/**
 * Build the mesh for a sheet about to turn. `grab` is where along the head-tail axis the sheet was
 * taken (-1 head, 0 square on, +1 tail), which is what leans the fan of rulings. Returns null when
 * the sheet cannot bend (the cover is a board, not paper) or has not been laid out yet — callers
 * then just turn it flat.
 */
export function buildMesh(sheet: HTMLElement, grab = 0): MeshRig | null {
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

  // The fan. Ruling j crosses the page's mid-height at j*sw whichever way it leans, so a square-on
  // turn is exactly a set of parallels and every other case still meets the old geometry down the
  // middle of the page. A corner grab puts the apex out past the corner it was taken by, on the
  // binding's own line, `apex` from mid-height; ruling j then leans by j*sw/apex — nil at the
  // binding, so ruling 0 stays the bound edge itself and the whole binding is the hinge. The
  // rulings crowd toward the held corner, which is how a lifted corner really folds: tightest at
  // the end of the binding nearest the finger, and the held corner, with the most rulings behind
  // it, is the most turned — it leads, and the far corner hangs back on the block.
  const lean = Math.tan(clamp(grab, -1, 1) * FAN_DEG * D2R)
  let apex = 0 // 0 stands for an apex infinitely far off: parallel rulings
  if (Math.abs(lean) > 1e-4) {
    apex = -w / lean
    const min = FAN_MIN_APEX * h
    if (Math.abs(apex) < min) apex = apex < 0 ? -min : min
  }
  const M = new Float64Array(n + 1)
  const DX = new Float64Array(n + 1)
  const DY = new Float64Array(n + 1)
  for (let j = 0; j <= n; j++) {
    const m = apex ? (j * sw) / apex : 0
    const len = Math.hypot(m, 1)
    M[j] = m
    DX[j] = m / len
    DY[j] = 1 / len
  }
  /** Where ruling j crosses the page at height y, clipped to the sheet. */
  const rule = (j: number, y: number) => clamp(j * sw + (y - h / 2) * M[j], 0, w)

  const root = document.createElement('div')
  root.className = 'ob__mesh'
  const strips: HTMLElement[] = []
  const shades: Slice[] = []
  const C = new Float64Array(8 * n)
  const BX = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    // the wedge between this strip's ruling and the next. Everything past the last ruling belongs
    // to the last strip: there is no hinge out there for it to bend about.
    const last = i === n - 1
    // every strip but the last runs a pixel past its ruling under the next strip: two strips meeting
    // at a sub-pixel seam otherwise let a hairline of whatever is beneath show through
    const xl0 = rule(i, 0)
    const xl1 = rule(i, h)
    const xr0 = last ? w : clamp(rule(i + 1, 0) + SEAM_LAP, 0, w)
    const xr1 = last ? w : clamp(rule(i + 1, h) + SEAM_LAP, 0, w)
    C.set([xl0, 0, xr0, 0, xr1, h, xl1, h], i * 8)
    // the strip's own box: the wedge's bounding box, so a leaning strip does not carry a page-wide
    // layer around with it
    const bx = Math.floor(Math.min(xl0, xl1))
    const bw = Math.max(1, Math.ceil(Math.max(xr0, xr1)) - bx)
    BX[i] = bx
    const fclip = `polygon(${px(xl0)}px 0px,${px(xr0)}px 0px,${px(xr1)}px ${px(h)}px,${px(xl1)}px ${px(h)}px)`
    // the verso is seen through the back of the sheet: its own x runs the other way
    const bclip = `polygon(${px(w - xl0)}px 0px,${px(w - xr0)}px 0px,${px(w - xr1)}px ${px(h)}px,${px(w - xl1)}px ${px(h)}px)`
    // the shade gradient: square to the strip's mean ruling, with a stop on each of its two rulings.
    // Both faces measure the same way from the gutter, so the two stops serve either.
    const th = Math.atan((M[i] + M[i + 1]) / 2)
    const gl = w * Math.cos(th) + h * Math.abs(Math.sin(th))
    const p0 = 0.5 + ((i * sw - w / 2) * Math.cos(th)) / gl
    const p1 = 0.5 + (((i + 1) * sw - w / 2) * Math.cos(th)) / gl
    const deg = th / D2R
    const lo = Math.min(xl0, xl1)
    const hi = Math.max(xr0, xr1)

    const strip = document.createElement('div')
    strip.className = 'ob__strip'
    strip.style.cssText = `left:${bx}px;width:${bw}px;height:${px(h)}px`
    const f = slice('front', bw, h, cloneSlice(front, extF, lo * scale, hi * scale, -bx, w, h, fclip), -bx, w, fclip, 90 - deg, p0, p1)
    // the verso slice is turned about its own centre, so its clone is offset from the far side
    const bl = bx + bw - w
    const b = slice('back', bw, h, cloneSlice(back, extB, (w - hi) * scale, (w - lo) * scale, bl, w, h, bclip), bl, w, bclip, 270 + deg, p0, p1)
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
    sheet, root, strips, shades, n, w, h, sw,
    A, Am, G, Gm, DX, DY, C, BX,
    R: new Float64Array(9 * n), T: new Float64Array(3 * n),
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

/**
 * Walk the hinge chain for a given bow and sag, filling each strip's frame.
 *
 * Strip 0 hinges about ruling 0, which is the bound edge, so its frame turns the paper about the
 * binding and leaves every point of the binding where it was. Each strip after it takes the frame
 * of the one before and adds a turn about the ruling the two share — the two strips therefore
 * agree along that whole ruling, and by induction the sheet hangs off the bound edge in one piece,
 * with no corner of it free to drift.
 */
function frames(rig: MeshRig, bow: number, sag: number) {
  const { n, sw, h, Am, Gm, DX, DY, R, T } = rig
  let r0 = 1, r1 = 0, r2 = 0, r3 = 0, r4 = 1, r5 = 0, r6 = 0, r7 = 0, r8 = 1
  let tx = 0, ty = 0, tz = 0
  let prev = 0
  for (let i = 0; i < n; i++) {
    const psi = bow * Am[i] + sag * Gm[i]
    const ang = (psi - prev) * D2R
    prev = psi
    // a turn of `ang` about ruling i: its direction through the point it crosses mid-height at
    const dx = DX[i]
    const dy = DY[i]
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const k = 1 - c
    const a0 = c + k * dx * dx, a1 = k * dx * dy, a2 = s * dy
    const a3 = a1, a4 = c + k * dy * dy, a5 = -s * dx
    const a6 = -s * dy, a7 = s * dx, a8 = c
    // the hinge runs through this point, so the turn must leave it where it is
    const qx = i * sw
    const qy = h / 2
    const ux = qx - (a0 * qx + a1 * qy)
    const uy = qy - (a3 * qx + a4 * qy)
    const uz = -(a6 * qx + a7 * qy)
    // compose onto the running frame: T += R u, then R = R A
    tx += r0 * ux + r1 * uy + r2 * uz
    ty += r3 * ux + r4 * uy + r5 * uz
    tz += r6 * ux + r7 * uy + r8 * uz
    const n0 = r0 * a0 + r1 * a3 + r2 * a6, n1 = r0 * a1 + r1 * a4 + r2 * a7, n2 = r0 * a2 + r1 * a5 + r2 * a8
    const n3 = r3 * a0 + r4 * a3 + r5 * a6, n4 = r3 * a1 + r4 * a4 + r5 * a7, n5 = r3 * a2 + r4 * a5 + r5 * a8
    const n6 = r6 * a0 + r7 * a3 + r8 * a6, n7 = r6 * a1 + r7 * a4 + r8 * a7, n8 = r6 * a2 + r7 * a5 + r8 * a8
    r0 = n0; r1 = n1; r2 = n2; r3 = n3; r4 = n4; r5 = n5; r6 = n6; r7 = n7; r8 = n8
    const o = i * 9
    R[o] = r0; R[o + 1] = r1; R[o + 2] = r2
    R[o + 3] = r3; R[o + 4] = r4; R[o + 5] = r5
    R[o + 6] = r6; R[o + 7] = r7; R[o + 8] = r8
    const u = i * 3
    T[u] = tx; T[u + 1] = ty; T[u + 2] = tz
  }
}

/** Where a point of the flat sheet has got to under strip i's frame, in the top view. */
function seat(rig: MeshRig, i: number, x: number, y: number): { x: number; z: number } {
  const { R, T } = rig
  const o = i * 9
  const u = i * 3
  return { x: R[o] * x + R[o + 1] * y + T[u], z: R[o + 6] * x + R[o + 7] * y + T[u + 2] }
}

/**
 * How far (deg) the worst corner of the current shape has passed through a block. A strip is flat,
 * so it reaches furthest at one of its corners: testing those tests the whole sheet.
 */
function through(rig: MeshRig, a: number): number {
  let over = 0
  for (let i = 0; i < rig.n; i++) {
    for (let k = 0; k < 4; k++) {
      const o = i * 8 + k * 2
      const p = seat(rig, i, rig.C[o], rig.C[o + 1])
      const c = a + Math.atan2(-p.z, p.x) / D2R
      if (c > over) over = c
      else if (-180 - c > over) over = -180 - c
    }
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

  // the blocks are a hard limit: no corner may pass through the pages beneath. Scale the whole
  // shape back until the worst one clears; hitting a block takes most of the springs' energy too
  frames(rig, rig.bow, rig.sag)
  if (through(rig, a) > 0) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2
      frames(rig, rig.bow * mid, rig.sag * mid)
      if (through(rig, a) > 0.02) hi = mid
      else lo = mid
    }
    rig.bow *= lo
    rig.sag *= lo
    rig.vel *= LANDING_KEEP
    rig.svel *= LANDING_KEEP
    frames(rig, rig.bow, rig.sag)
  }
  const fore = seat(rig, rig.n - 1, rig.w, rig.h / 2)
  rig.tip = Math.atan2(-fore.z, fore.x) / D2R

  // each strip is laid down by its own frame, which the strip before it handed on
  const { n, R, T, BX, A, G, bow, sag } = rig
  const sinA = -Math.sin(a * D2R) // how far the sheet is lifted off the block (0 flat, 1 upright)
  const shadeF = (u: number, deg: number) => shade(deg, 1, u, GUTTER_FRONT, sinA)
  const shadeB = (u: number, deg: number) => shade(deg, -1, u, GUTTER_BACK, sinA)
  let s0f = shadeF(0, a)
  let s0b = shadeB(0, a)
  for (let i = 0; i < n; i++) {
    const o = i * 9
    const u = i * 3
    // the strip's box starts partway across the sheet, so its frame is rebased onto that corner
    const b = BX[i]
    const tx = R[o] * b + T[u] - b
    const ty = R[o + 3] * b + T[u + 1]
    const tz = R[o + 6] * b + T[u + 2]
    rig.strips[i].style.transform = 'matrix3d('
      + `${R[o].toFixed(5)},${R[o + 3].toFixed(5)},${R[o + 6].toFixed(5)},0,`
      + `${R[o + 1].toFixed(5)},${R[o + 4].toFixed(5)},${R[o + 7].toFixed(5)},0,`
      + `${R[o + 2].toFixed(5)},${R[o + 5].toFixed(5)},${R[o + 8].toFixed(5)},0,`
      + `${px(tx)},${px(ty)},${px(tz)},1)`
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
