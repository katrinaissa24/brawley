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
 * Shape. The tangent angle along the page is B · P(u): u is the distance from the gutter (0..1),
 * B the fore-edge tangent's lean away from the gutter tangent (the bow, in degrees), and P a
 * curvature profile with zero curvature at both ends — the binding is a pin and the fore-edge is
 * free, neither carries a bending moment — that peaks a little inside the middle of the page,
 * where the moment from a distributed load peaks. That is what gives a page its broad, even bow
 * rather than a hinge and a flat lip.
 *
 * Dynamics. The bow chases a target through an underdamped spring, and the target depends on
 * what is moving the page:
 *   · held by its edge (a drag), the body hangs between the pinned gutter and the finger: it lags
 *     the motion and it droops under gravity, more the flatter the page lies;
 *   · in free flight (a flick, a click), the fore-edge trails whatever momentum the page carries,
 *     and the tip droops toward the block it leans over.
 * The target fades out at the ends of the turn, where the sheet lies on the block. The block is
 * also a hard limit: no vertex may pass through the page beneath, so the bow is clamped to keep
 * the fore-edge above both blocks and the spring's velocity is killed when the clamp bites — the
 * slap of a landing page. The rig outlives the turn for as long as the bow takes to settle.
 *
 * Light. Each vertex is lit by one light overhead and a little to the right (Lambert), plus the
 * shadow the gutter throws across the first half of a lifted page. Every strip carries a gradient
 * between the shade values at its two vertices, so the shading is continuous across the strip
 * seams and the bow reads in the light before the silhouette shows it.
 */
import { MOTION } from '@/feel/motion'

/** Strips across a page: one per ~34px, never fewer than 10 nor more than 16. */
const STRIP_PX = 34
const MIN_STRIPS = 10
const MAX_STRIPS = 16
/** The bow spring: k / c for zeta ~0.62 — one soft overshoot, the way a sheet settles. */
const K = 260
const C = 20
/** Degrees of bow per deg/s of turn. A quick click flip runs at 600-700 deg/s. */
const TRAIL = 30
/** Gravity: how far the tip droops (free) or the body hangs (held), deg, at the flattest. */
const DROOP_FREE = 5
const DROOP_HELD = 7
const MAX_BOW = 30
/** The light: overhead, a little to the right; how dark a face turned edge-on to it gets, and how
    gently the darkening comes on (paper is matte and the room is bright: a page tilted a little
    stays white, only a page seen nearly edge-on goes grey). */
const LIGHT_X = 0.22
const LAMBERT = 0.42
const LAMBERT_CURVE = 1.5
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
 * The curvature profile, integrated once: P(u) = ∫0..u κ / ∫0..1 κ with κ(u) = u (1-u)^1.5,
 * which is zero at both ends and peaks at u = 0.4. Sampled at 1/64 steps.
 */
const PROFILE = (() => {
  const n = 64
  const p = new Float64Array(n + 1)
  let acc = 0
  for (let i = 1; i <= n; i++) {
    const u = (i - 0.5) / n
    acc += u * Math.pow(1 - u, 1.5)
    p[i] = acc
  }
  for (let i = 0; i <= n; i++) p[i] /= acc
  return p
})()
function profileAt(u: number): number {
  const x = clamp(u, 0, 1) * 64
  const i = Math.min(63, Math.floor(x))
  return PROFILE[i] + (PROFILE[i + 1] - PROFILE[i]) * (x - i)
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
  /** the profile at the vertices (n+1) and at the strip midpoints (n) */
  P: Float64Array
  Pm: Float64Array
  /** the bow (fore-edge tangent lean, deg) and its velocity */
  bow: number
  vel: number
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
  const P = new Float64Array(n + 1)
  const Pm = new Float64Array(n)
  for (let i = 0; i <= n; i++) P[i] = profileAt(i / n)
  for (let i = 0; i < n; i++) Pm[i] = profileAt((i + 0.5) / n)

  sheet.appendChild(root)
  sheet.dataset.mesh = ''
  return { sheet, root, strips, shades, n, w, sw, P, Pm, bow: 0, vel: 0, tip: 0, held: false, lastA: 0, lastT: 0 }
}

/** Take the mesh down and give the sheet its flat faces back. */
export function releaseMesh(rig: MeshRig | null) {
  if (!rig) return
  delete rig.sheet.dataset.mesh
  rig.root.remove()
}

/* ---------- one frame ---------- */

/** The fore-edge's position angle (deg, in the sheet's rotateY sense) for a bow of `bow`. */
function tipAngle(rig: MeshRig, bow: number): number {
  let x = 0, z = 0
  for (let i = 0; i < rig.n; i++) {
    const phi = bow * rig.Pm[i] * D2R
    x += Math.cos(phi)
    z -= Math.sin(phi)
  }
  return Math.atan2(-z, x) / D2R
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
  if (dt > 0) {
    const omega = (a - rig.lastA) / dt // deg/s
    // held: the body lags the finger and hangs under its weight; free: the tip trails and droops
    const target = rig.held
      ? (omega / TRAIL - DROOP_HELD * Math.cos(a * D2R)) * arc
      : (-omega / TRAIL + DROOP_FREE * Math.cos(a * D2R)) * arc
    rig.vel += (-K * (rig.bow - clamp(target, -MAX_BOW, MAX_BOW)) - C * rig.vel) * dt
    rig.bow += rig.vel * dt
  }
  rig.lastA = a
  rig.lastT = now

  // the block beneath is a hard limit: the fore-edge (the vertex furthest from the gutter tangent)
  // stays between the two blocks, and hitting one takes the spring's energy with it
  let tip = tipAngle(rig, rig.bow)
  const over = a + tip > 0 ? -a : a + tip < -180 ? -180 - a : null
  if (over !== null && Math.abs(tip) > 1e-6) {
    rig.bow *= over / tip
    rig.vel = 0
    tip = tipAngle(rig, rig.bow)
  }
  rig.tip = tip

  // the chain: each strip starts where the previous ends, turned by the tangent at its middle
  const bow = rig.bow
  let x = 0, z = 0
  const sinA = -Math.sin(a * D2R) // how far the sheet is lifted off the block (0 flat, 1 upright)
  const shadeF = (u: number, deg: number) => shade(deg, 1, u, GUTTER_FRONT, sinA)
  const shadeB = (u: number, deg: number) => shade(deg, -1, u, GUTTER_BACK, sinA)
  let s0f = shadeF(0, a), s0b = shadeB(0, a)
  for (let i = 0; i < rig.n; i++) {
    const phi = bow * rig.Pm[i]
    rig.strips[i].style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${phi.toFixed(3)}deg)`
    const r = phi * D2R
    x += rig.sw * Math.cos(r)
    z -= rig.sw * Math.sin(r)
    const u1 = (i + 1) / rig.n
    const deg1 = a + bow * rig.P[i + 1]
    const s1f = shadeF(u1, deg1), s1b = shadeB(u1, deg1)
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
