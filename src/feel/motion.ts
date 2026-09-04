/** Global motion flags. App keeps `reduced` in sync with the OS + the setting. */
export const MOTION = {
  speed: 1, // Shift while triggering a choreography → 0.25 (debug/delight)
  reduced: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
}
export function setReducedMotion(on: boolean) {
  MOTION.reduced = on
  document.documentElement.dataset.reduceMotion = on ? 'on' : 'off'
}
/** Duration in ms honoring MOTION.speed and reduced motion (crossfades cap at 160ms). */
export const dur = (ms: number, reducedMs = 150) => (MOTION.reduced ? reducedMs : ms / MOTION.speed)

export const EASE = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  outExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  hinge: 'cubic-bezier(0.5, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  inSoft: 'cubic-bezier(0.4, 0, 1, 1)',
} as const
