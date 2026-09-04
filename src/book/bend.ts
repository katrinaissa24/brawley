/**
 * The bend rig — what turns a rotating rectangle into a sheet of paper.
 *
 * A real page does not pivot rigidly about its gutter: the half nearest the spine stays roughly
 * flat while the free edge trails behind, so the sheet reads as a shallow curve whose deepest
 * bend sits near the fore-edge. This models that with four panels hinged in a chain from the
 * gutter outwards. The root panel (46% of the width) never rotates relative to the sheet, so it
 * can be the *real* faces simply clipped to that width — only the three outer panels need their
 * own copies of the page, and only for as long as the sheet is in the air.
 *
 * Geometry, per turning sheet:
 *
 *   .ob__sheet            rotate3d(--ax, 1, 0, --a)      the gutter hinge, owned by useFlip
 *     .ob__face.-front    clipped to the root panel's width (right edge clipped away)
 *     .ob__face.-back     clipped likewise (its 180deg turn puts world-left at its local right)
 *     .ob__bend
 *       .ob__pan  i=1     left = 46%W, rotateY(d1)
 *         .ob__pslice.-front   width w1, holds a clone of the recto shifted left by that panel's x0
 *         .ob__pslice.-back    rotateY(180deg), holds a clone of the verso shifted to match
 *         .ob__pan  i=2   left = w1, rotateY(d2)         · rotations accumulate down the chain
 *           .ob__pan i=3  left = w2, rotateY(d3)
 *
 * Rotations accumulate because each panel nests inside the previous one, so `d` is the *extra*
 * lean of each hinge and the deepest curvature lands where the shares are biggest — at the free
 * edge. Nothing here reads layout during a turn: every width is measured once, at build.
 */

/** Panel widths as fractions of the page, gutter -> fore-edge. The first is the un-rotated root. */
const PANELS = [0.46, 0.22, 0.17, 0.15] as const
/** Where each panel starts, as a fraction of the page. */
const STARTS = [0, 0.46, 0.68, 0.85] as const
/** How the total bend splits across the three hinges; weighted to the free edge. */
const SHARE = [0.22, 0.34, 0.44] as const

const D2R = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface Slice { front: HTMLElement; back: HTMLElement }

export interface BendRig {
  root: HTMLElement
  /** the three rotating panels, gutter -> fore-edge */
  panels: HTMLElement[]
  /** the shade layer of each panel's two slices */
  shades: Slice[]
  /** the real faces, clipped to the root panel while the rig is up */
  faces: HTMLElement[]
  /** current bend in degrees and its velocity, integrated by writeBend */
  bend: number
  vel: number
  lastA: number
  lastT: number
}

/** Strip a cloned face down to something inert: no shade of its own, no controls, no hit testing. */
function cleanClone(src: HTMLElement, endpaper: boolean, left: number, w: number, h: number) {
  const c = src.cloneNode(true) as HTMLElement
  c.className = 'ob__face ob__pclone' + (endpaper ? ' -endpaper' : '')
  c.removeAttribute('data-page')
  c.style.cssText = `inset:auto;left:${left.toFixed(2)}px;top:0;width:${w.toFixed(2)}px;height:${h.toFixed(2)}px`
  c.querySelector('.ob__shade')?.remove()
  c.querySelector('.ob__opt')?.remove()
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
 * Build the rig for a sheet about to turn. Returns null when the sheet cannot bend (the cover is a
 * board, not paper) or when it has not been laid out yet — callers then just turn it flat.
 */
export function buildBend(sheet: HTMLElement): BendRig | null {
  const front = sheet.querySelector<HTMLElement>(':scope > .ob__face.-front')
  const back = sheet.querySelector<HTMLElement>(':scope > .ob__face.-back')
  if (!front || !back) return null
  const w = sheet.offsetWidth
  const h = sheet.offsetHeight
  if (w < 8 || h < 8) return null

  const root = document.createElement('div')
  root.className = 'ob__bend'
  const panels: HTMLElement[] = []
  const shades: Slice[] = []
  let parent: HTMLElement = root

  for (let i = 1; i < PANELS.length; i++) {
    const x0 = STARTS[i] * w
    const pw = PANELS[i] * w
    const pan = document.createElement('div')
    pan.className = 'ob__pan'
    // panel 1 hangs off the rig (which spans the sheet); the rest hang off the previous panel's edge
    pan.style.cssText = `left:${((i === 1 ? STARTS[1] : PANELS[i - 1]) * w).toFixed(2)}px;width:${pw.toFixed(2)}px;height:${h.toFixed(2)}px`
    const f = slice('front', pw, h, cleanClone(front, false, -x0, w, h))
    // the back slice's own 180deg turn maps its local left edge to this panel's outer edge, so the
    // verso clone is offset from the far side of the page
    const b = slice('back', pw, h, cleanClone(back, back.classList.contains('-endpaper'), -(w - x0 - pw), w, h))
    pan.appendChild(f.el)
    pan.appendChild(b.el)
    parent.appendChild(pan)
    panels.push(pan)
    shades.push({ front: f.shade, back: b.shade })
    parent = pan
  }

  const cut = (w - PANELS[0] * w).toFixed(2)
  front.style.clipPath = `inset(0 ${cut}px 0 0)`
  back.style.clipPath = `inset(0 0 0 ${cut}px)`
  sheet.appendChild(root)

  return { root, panels, shades, faces: [front, back], bend: 0, vel: 0, lastA: 0, lastT: 0 }
}

/** Take the rig down and give the sheet its whole faces back. */
export function releaseBend(rig: BendRig | null) {
  if (!rig) return
  for (const f of rig.faces) f.style.clipPath = ''
  rig.root.remove()
}

/**
 * One frame of bend. `a` is the sheet's own angle (0 flat right .. -180 flat left) and `dir` the
 * direction of the turn; `now` comes from the animation clock.
 *
 * The target lean has two sources: the sheet's angular velocity, because paper trails whatever is
 * dragging it, and gravity, because a page held halfway sags towards the side it is leaning on.
 * Both fade out at either end of the turn, where the sheet is lying on the block and flat. The
 * lean then chases that target through an underdamped spring, which is what produces the trailing
 * curve on a fast flip and the single flutter as the page comes to rest.
 */
export function writeBend(rig: BendRig, a: number, dir: 1 | -1, now: number) {
  const dt = rig.lastT ? clamp((now - rig.lastT) / 1000, 0.001, 0.05) : 0.016
  const omega = (a - rig.lastA) / dt // deg/s
  rig.lastA = a
  rig.lastT = now

  const p = clamp(dir === 1 ? -a / 180 : (180 + a) / 180, 0, 1)
  const arc = Math.sin(Math.PI * p) // no bend while the sheet lies flat at either end
  const trail = clamp(-omega / 26, -30, 30)
  const sag = 8 * Math.cos(a * D2R)
  const target = (trail + sag) * arc

  // k 210 / c 17 -> zeta about 0.59: one visible overshoot, the way a sheet settles
  rig.vel += (-210 * (rig.bend - target) - 17 * rig.vel) * dt
  rig.bend += rig.vel * dt
  const bend = clamp(rig.bend, -46, 46)

  // Shade by how far each hinge has turned away from the flat sheet, not by its absolute angle:
  // that keeps the ramp continuous across the panel seams and zero where the un-clipped face ends.
  const shade = (turn: number) => clamp(Math.abs(turn) * 0.0092, 0, 0.42)
  let turned = 0
  for (let i = 0; i < rig.panels.length; i++) {
    const d = bend * SHARE[i]
    const s0 = shade(turned)
    turned += d
    const s1 = shade(turned)
    rig.panels[i].style.transform = `rotateY(${d.toFixed(3)}deg)`
    const { front, back } = rig.shades[i]
    front.style.setProperty('--s0', s0.toFixed(3))
    front.style.setProperty('--s1', s1.toFixed(3))
    back.style.setProperty('--s0', (s0 * 0.7).toFixed(3))
    back.style.setProperty('--s1', (s1 * 0.7).toFixed(3))
  }
  return arc
}
