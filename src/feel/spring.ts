import { MOTION } from './motion'

export type Spring = { k: number; c: number; m?: number }
export const SPRINGS = {
  snappy: { k: 520, c: 38 }, // ζ≈0.83, ~320ms — pull-out, drop, selection
  gentle: { k: 170, c: 26 }, // ζ≈1.0, ~420ms — returns, neighbours
  wobbly: { k: 300, c: 20 }, // ζ≈0.58, one overshoot — stickers, undo restore
  flipLand: { k: 260, c: 26 }, // ζ≈0.81 — page landing
  glue: { k: 900, c: 60 }, // 1-frame follower
} as const satisfies Record<string, Spring>

/** Fixed-substep spring integrator. Returns a cancel function. */
export function animateSpring(o: {
  from: number
  to: number
  v0?: number
  spring: Spring
  onFrame: (x: number, v: number) => void
  onDone?: () => void
  epsilon?: number
}): () => void {
  if (MOTION.reduced) {
    o.onFrame(o.to, 0)
    o.onDone?.()
    return () => {}
  }
  const { k, c, m = 1 } = o.spring
  const eps = o.epsilon ?? 0.01
  let x = o.from
  let v = o.v0 ?? 0
  let last = performance.now()
  let raf = 0
  const step = () => {
    const now = performance.now()
    let dt = Math.min((now - last) / 1000, 0.064) / MOTION.speed
    last = now
    while (dt > 0) {
      const h = Math.min(dt, 1 / 120)
      v += ((-k * (x - o.to) - c * v) / m) * h
      x += v * h
      dt -= h
    }
    if (Math.abs(x - o.to) < eps && Math.abs(v) < eps * 10) {
      o.onFrame(o.to, 0)
      o.onDone?.()
      return
    }
    o.onFrame(x, v)
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}

/** Simple tween on a bezier-like ease (for programmatic, system-driven motion). */
export function tween(o: {
  from: number
  to: number
  ms: number
  ease?: (t: number) => number
  onFrame: (x: number, t: number) => void
  onDone?: () => void
}): () => void {
  const ease = o.ease ?? easeOutExpo
  const ms = MOTION.reduced ? 0 : o.ms / MOTION.speed
  if (ms === 0) {
    o.onFrame(o.to, 1)
    o.onDone?.()
    return () => {}
  }
  const t0 = performance.now()
  let raf = 0
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / ms)
    o.onFrame(o.from + (o.to - o.from) * ease(t), t)
    if (t < 1) raf = requestAnimationFrame(step)
    else o.onDone?.()
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}
export const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5)
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
