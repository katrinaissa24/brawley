/**
 * Making room on the shelf. A hovered book is pulled toward the eye and swung open, and because a
 * book is a box 160px deep, its back corner sweeps sideways into the neighbour it swings toward.
 * Real books cannot pass through one another, so the row gives way: every book on that side
 * slides over by exactly the clearance the swung box needs — measured, not guessed — and the push
 * runs down the row the way it does on a real shelf, each book moving only as far as the one
 * before it makes it, until the slack in the gaps has absorbed it. The other side is untouched by
 * the swing and only breathes.
 *
 * The pose numbers here are the ones in shelf.css (`.book[data-hover]`); the shelf writes them
 * onto its root as custom properties so the CSS and this geometry can never disagree.
 */
import { BOOK } from '@/model/types'
import type { Slot } from './layout'

/** The hovered pose: pulled toward the eye, swung open, head tipped out. Neighbours breathe. */
export const HOVER = {
  /** translateZ, px */
  pull: 44,
  /** rotateY, deg (the book swings its back away from the eye, to the right) */
  swing: 22,
  /** rotateX, deg (the head comes forward, the tail goes back) */
  tip: 9,
  /** a neighbour's lean per unit of --breathe, deg */
  lean: 4,
  /** a neighbour's lift toward the eye per unit of --breathe squared, px */
  lift: 8,
} as const
/** The pull-out eases with an overshoot; clearance is measured at its peak, not its target. */
const OVERSHOOT = 1.1
/** Faces never quite touch. Also covers the ±0.35deg hand-placed tilt of each book. */
const MIN_GAP = 3
/** The breathing of the two nearest books on each side: how much they lean, and the least they slide. */
const BREATHE = [1, 0.4] as const
const BREATHE_SLIDE = [5, 2] as const
const MAX_RIPPLE = 28

const D2R = Math.PI / 180
const D = BOOK.depth
const H = BOOK.h

interface Pt { x: number; z: number }
/** One vertical side of a box in top view: the line from its front edge to its back edge. */
interface Face { xf: number; zf: number; xb: number; zb: number }
interface Pose { rx: number; ry: number; tz: number; tx: number }

/**
 * The world (x, z) corners of the face on `side` (+1 right, -1 left) of a box whose left edge is at
 * X, after `pose` (rotateX, then rotateY, then translate — the order the book transform applies
 * them in), about the centre of its spine like the CSS does. With a rotateX the head and the tail
 * swing differently, so all four corners come back; a flat box needs only its two edges.
 */
function corners(X: number, W: number, side: 1 | -1, p: Pose): Pt[] {
  const cx = Math.cos(p.rx * D2R), sx = Math.sin(p.rx * D2R)
  const cy = Math.cos(p.ry * D2R), sy = Math.sin(p.ry * D2R)
  const x0 = side * W / 2
  // a closed loop: front-top, back-top, back-bottom, front-bottom (or just front, back when flat)
  const order: [number, number][] = p.rx
    ? [[-H / 2, 0], [-H / 2, -D], [H / 2, -D], [H / 2, 0]]
    : [[0, 0], [0, -D]]
  const out: Pt[] = []
  for (const [y, z] of order) {
    const z1 = y * sx + z * cx
    const x2 = x0 * cy + z1 * sy
    const z2 = -x0 * sy + z1 * cy
    out.push({ x: X + W / 2 + x2 + p.tx, z: z2 + p.tz })
  }
  return out
}

function faceOf(pts: Pt[]): Face {
  return { xf: pts[0].x, zf: pts[0].z, xb: pts[1].x, zb: pts[1].z }
}
const faceX = (f: Face, z: number) => f.xf + (f.zb === f.zf ? 0 : ((z - f.zf) * (f.xb - f.xf)) / (f.zb - f.zf))

/**
 * How far `face` (the left side of the next book) must move right so that the `pusher` polygon
 * (the right side of the book before it) no longer crosses it: the largest overshoot of any point
 * of the pusher that lies within the face's depth. Both are straight in top view, so the extreme is
 * at a corner or where an edge of the pusher enters the face's depth range.
 */
function clearance(pusher: Pt[], face: Face): number {
  const zHi = Math.max(face.zf, face.zb), zLo = Math.min(face.zf, face.zb)
  let need = -Infinity
  const test = (p: Pt) => { const n = p.x + MIN_GAP - faceX(face, p.z); if (n > need) need = n }
  const n = pusher.length
  for (let i = 0; i < n; i++) {
    const a = pusher[i], b = pusher[(i + 1) % n]
    if (a.z >= zLo && a.z <= zHi) test(a)
    for (const zc of [zLo, zHi]) {
      if ((a.z - zc) * (b.z - zc) < 0) {
        const t = (zc - a.z) / (b.z - a.z)
        test({ x: a.x + (b.x - a.x) * t, z: zc })
      }
    }
  }
  return need
}

export interface Shove { id: string; shove: number; breathe: number }

/**
 * The slide for every book that has to give way on one side of the hovered slot. Works in a frame
 * where the neighbours run to the right of the pusher; the left side is folded into that frame by
 * mirroring x, so one walk serves both.
 */
function cascade(pusher0: Pt[], run: { id: string; left: number; w: number }[]): Shove[] {
  const out: Shove[] = []
  let pusher = pusher0
  for (let k = 0; k < run.length && k < MAX_RIPPLE; k++) {
    const b = run[k]
    const breathe = BREATHE[k] ?? 0
    const pose: Pose = { rx: 0, ry: -HOVER.lean * breathe, tz: HOVER.lift * breathe * breathe, tx: 0 }
    const need = clearance(pusher, faceOf(corners(b.left, b.w, -1, pose)))
    const shove = Math.max(0, need, BREATHE_SLIDE[k] ?? 0)
    if (shove <= 0) break
    out.push({ id: b.id, shove, breathe })
    pusher = corners(b.left, b.w, 1, { ...pose, tx: shove })
  }
  return out
}

/** Every book that slides, and by how much (px, signed: right is positive), when slot `i` is hovered. */
export function makeRoom(slots: readonly Pick<Slot, 'id' | 'x' | 'w'>[], i: number): Shove[] {
  const h = slots[i]
  if (!h) return []
  const pose: Pose = { rx: -HOVER.tip * OVERSHOOT, ry: -HOVER.swing * OVERSHOOT, tz: HOVER.pull * OVERSHOOT, tx: 0 }
  const right = cascade(
    corners(h.x, h.w, 1, pose),
    slots.slice(i + 1, i + 1 + MAX_RIPPLE).map(s => ({ id: s.id, left: s.x, w: s.w })),
  )
  // the left side, seen in a mirror: x -> -x turns it into another run to the right. The swing
  // carries the back of the box away from this side, so here the walk finds nothing to clear and
  // the books only breathe.
  const mirrored = corners(h.x, h.w, -1, pose).map(p => ({ x: -p.x, z: p.z }))
  const leftRun: { id: string; left: number; w: number }[] = []
  for (let k = i - 1; k >= 0 && leftRun.length < MAX_RIPPLE; k--) leftRun.push({ id: slots[k].id, left: -(slots[k].x + slots[k].w), w: slots[k].w })
  const left = cascade(mirrored, leftRun).map(s => ({ ...s, shove: -s.shove, breathe: -s.breathe }))
  return right.concat(left)
}
