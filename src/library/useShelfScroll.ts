/**
 * useShelfScroll — the shelf's one rAF loop. The scroller is native (OS momentum, rubber-band);
 * this hook mirrors scrollLeft into translate3d on the moving layers, windows the mounted slots,
 * fires detents (sound + a visual dip), and owns every other way scrollLeft can move: vertical
 * mouse-wheel glide, mouse drag with momentum, and programmatic tweens (silent — no ticks).
 * Nothing here touches React per frame; state changes only when the integer window changes.
 */
import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { MOTION } from '@/feel/motion'
import { sound } from '@/feel/sound'
import { easeOutExpo, tween } from '@/feel/spring'
import { useStore } from '@/model/store'
import { OVERSCAN, PLANK_SEG, clamp, lowerBound, nearestSlot, type ShelfLayout } from './layout'

export interface ShelfWindow { first: number; last: number; pk0: number; pk1: number }

export interface ScrollHandlers {
  /** the integer range of mounted slots / plank segments changed (React state lives here) */
  onWindow(w: ShelfWindow): void
  /** the slot nearest the focus line changed */
  onCentre(index: number, dir: 1 | -1): void
  /** scrolling started (true) / went idle 900ms after the last scroll event (false) */
  onActivity(scrolling: boolean): void
  /** every frame (write to the DOM directly; never set state here) */
  onProgress(x: number, max: number, vw: number): void
  /** a spine centre crossed the focus line at a browsing speed: visual bump */
  onDetent(index: number): void
  /** scroll settled: persist */
  onScrollEnd(x: number): void
}

export interface ShelfScroll {
  x(): number
  vw(): number
  max(): number
  /** run the frame now (windowing + transforms); used after layout changes and for sync mounts */
  sync(): void
  /** instant, silent (no detents), then sync */
  jumpTo(x: number): void
  /** rAF-driven scrollLeft tween; silent (no detents) */
  scrollTo(x: number, o?: { ms?: number; ease?: (t: number) => number; onDone?: () => void }): void
  /** user-driven immediate write (scrubber drag): detents stay live */
  dragTo(x: number): void
  /** mouse drag on the wall/plank: 1:1 with momentum on release */
  beginDrag(clientX: number): { move(clientX: number): void; end(): void }
  cancel(): void
  isBusy(): boolean
}

export function useShelfScroll(o: {
  root: RefObject<HTMLElement>
  scroller: RefObject<HTMLElement>
  layers: RefObject<HTMLElement>[]
  layout: MutableRefObject<ShelfLayout>
  handlers: ScrollHandlers
}): ShelfScroll {
  const hRef = useRef(o.handlers)
  hRef.current = o.handlers
  const st = useRef({
    x: 0, prevX: 0, prevT: 0, vw: 0,
    raf: 0, idle: 0, active: false,
    silent: 0, lastTick: -1e9, lastNear: -1,
    win: { first: -1, last: -1, pk0: 0, pk1: -1 } as ShelfWindow,
    cancelTween: null as null | (() => void),
    glideTarget: 0, gliding: false, glideRaf: 0,
    momentumRaf: 0, dragging: false,
  }).current

  const ctrl = useRef<ShelfScroll | null>(null)
  if (!ctrl.current) {
    const sc = () => o.scroller.current
    const maxScroll = () => { const s = sc(); return s ? Math.max(0, s.scrollWidth - s.clientWidth) : 0 }

    const frame = () => {
      st.raf = 0
      const s = sc()
      if (!s) return
      const now = performance.now()
      const x = s.scrollLeft
      const t = `translate3d(${-x}px,0,0)`
      for (const l of o.layers) if (l.current) l.current.style.transform = t
      const L = o.layout.current
      const n = L.slots.length
      const dt = Math.max(1, now - st.prevT)
      const vel = ((x - st.prevX) / dt) * 1000
      // detents: spine centres crossed since the last frame
      if (n && x !== st.prevX) {
        const lo = Math.min(st.prevX, x)
        const hi = Math.max(st.prevX, x)
        const c = L.centers
        let i = lowerBound(c, lo, n)
        if (i < n && c[i] === lo) i++
        const detentsOn = useStore.getState().settings.detents !== 'off'
        const fast = Math.abs(vel) > 2500
        for (; i < n && c[i] <= hi; i++) {
          if (st.silent) continue
          const month = L.monthStart.has(i)
          if (fast && !month) continue
          if (month || now - st.lastTick >= 35) { sound.tick(month); st.lastTick = now }
          if (detentsOn && !fast && !MOTION.reduced) hRef.current.onDetent(i)
        }
      }
      if (n) {
        const ni = nearestSlot(L, x)
        if (ni !== st.lastNear) { const dir: 1 | -1 = ni >= st.lastNear ? 1 : -1; st.lastNear = ni; hRef.current.onCentre(ni, dir) }
      }
      // mounted window
      const half = st.vw / 2
      let first = 0
      let last = -1
      if (n) {
        const lo = x - half - OVERSCAN
        const hi = x + half + OVERSCAN
        first = Math.max(0, lowerBound(L.xs, lo, n + 1) - 1)
        last = Math.min(n - 1, lowerBound(L.xs, hi, n + 1) - 1)
      }
      const pk0 = Math.floor((x - half - 200) / PLANK_SEG)
      const pk1 = Math.floor((x + half + 200) / PLANK_SEG)
      const w = st.win
      if (first !== w.first || last !== w.last || pk0 !== w.pk0 || pk1 !== w.pk1) {
        st.win = { first, last, pk0, pk1 }
        hRef.current.onWindow(st.win)
      }
      hRef.current.onProgress(x, L.width, st.vw)
      st.prevX = x
      st.prevT = now
      st.x = x
    }
    const schedule = () => { if (!st.raf) st.raf = requestAnimationFrame(frame) }
    const stopGlide = () => { st.gliding = false; if (st.glideRaf) cancelAnimationFrame(st.glideRaf); st.glideRaf = 0 }
    const stopMomentum = () => { if (st.momentumRaf) cancelAnimationFrame(st.momentumRaf); st.momentumRaf = 0 }
    const stopTween = () => { if (st.cancelTween) { st.cancelTween(); st.cancelTween = null } }
    const cancelAll = () => { stopGlide(); stopMomentum(); stopTween() }

    const momentum = (v0: number) => {
      let v = v0
      if (Math.abs(v) < 0.5) return
      const step = () => {
        const s = sc()
        if (!s) return
        v *= 0.95
        if (Math.abs(v) < 0.5) { st.momentumRaf = 0; return }
        s.scrollLeft += v
        if (s.scrollLeft <= 0 || s.scrollLeft >= maxScroll()) { st.momentumRaf = 0; return }
        st.momentumRaf = requestAnimationFrame(step)
      }
      st.momentumRaf = requestAnimationFrame(step)
    }

    ctrl.current = {
      x: () => st.x,
      vw: () => st.vw,
      max: maxScroll,
      sync() { if (st.raf) cancelAnimationFrame(st.raf); frame() },
      jumpTo(x) {
        const s = sc()
        if (!s) return
        cancelAll()
        s.scrollLeft = clamp(x, 0, maxScroll())
        st.prevX = s.scrollLeft // no crossings for a jump
        this.sync()
      },
      scrollTo(x, opts) {
        const s = sc()
        if (!s) return
        cancelAll()
        const from = s.scrollLeft
        const to = clamp(x, 0, maxScroll())
        if (Math.abs(from - to) < 0.5) { opts?.onDone?.(); return }
        st.silent++
        let released = false
        const release = () => { if (!released) { released = true; st.silent-- } }
        const cancel = tween({
          from, to, ms: opts?.ms ?? 520, ease: opts?.ease ?? easeOutExpo,
          onFrame: v => { s.scrollLeft = v },
          onDone: () => { st.cancelTween = null; window.setTimeout(release, 60); opts?.onDone?.() },
        })
        st.cancelTween = () => { cancel(); release() }
      },
      dragTo(x) {
        const s = sc()
        if (!s) return
        cancelAll()
        s.scrollLeft = clamp(x, 0, maxScroll())
      },
      beginDrag(clientX) {
        const s = sc()
        cancelAll()
        st.dragging = true
        const x0 = s ? s.scrollLeft : 0
        const samples: [number, number][] = []
        return {
          move(cx) {
            if (!s) return
            s.scrollLeft = x0 - (cx - clientX)
            samples.push([performance.now(), cx])
            if (samples.length > 4) samples.shift()
          },
          end() {
            st.dragging = false
            if (samples.length < 2) return
            const [t0, a] = samples[0]
            const [t1, b] = samples[samples.length - 1]
            if (performance.now() - t1 > 80) return // the pointer paused before release
            const pxPerMs = -(b - a) / Math.max(1, t1 - t0)
            momentum(pxPerMs * (1000 / 60))
          },
        }
      },
      cancel: cancelAll,
      isBusy: () => st.dragging || st.gliding || !!st.cancelTween || !!st.momentumRaf,
    }

    // listeners are bound in the effect below; keep the closures reachable
    ;(ctrl.current as ShelfScroll & { _bind?: () => () => void })._bind = () => {
      const s = sc()
      const root = o.root.current
      if (!s) return () => {}
      const onScroll = () => {
        schedule()
        if (!st.active) { st.active = true; hRef.current.onActivity(true) }
        window.clearTimeout(st.idle)
        st.idle = window.setTimeout(() => {
          st.active = false
          hRef.current.onActivity(false)
          hRef.current.onScrollEnd(s.scrollLeft)
        }, 900)
      }
      const onWheel = (e: WheelEvent) => {
        if (e.ctrlKey || e.deltaMode !== 0 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
        e.preventDefault()
        stopMomentum()
        stopTween()
        st.glideTarget = clamp((st.gliding ? st.glideTarget : s.scrollLeft) + e.deltaY, 0, maxScroll())
        if (st.gliding) return
        st.gliding = true
        const step = () => {
          if (!st.gliding) return
          const d = st.glideTarget - s.scrollLeft
          if (Math.abs(d) < 1) { s.scrollLeft = st.glideTarget; st.gliding = false; st.glideRaf = 0; return }
          const inc = d * 0.18
          s.scrollLeft += Math.abs(inc) < 1 ? Math.sign(d) : inc
          st.glideRaf = requestAnimationFrame(step)
        }
        st.glideRaf = requestAnimationFrame(step)
      }
      s.addEventListener('scroll', onScroll, { passive: true })
      s.addEventListener('wheel', onWheel, { passive: false })
      const ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect.width ?? s.clientWidth
        st.vw = w
        root?.style.setProperty('--vw', `${Math.round(w)}px`)
        schedule()
      })
      ro.observe(s)
      st.vw = s.clientWidth
      root?.style.setProperty('--vw', `${Math.round(st.vw)}px`)
      return () => {
        s.removeEventListener('scroll', onScroll)
        s.removeEventListener('wheel', onWheel)
        ro.disconnect()
        cancelAll()
        if (st.raf) cancelAnimationFrame(st.raf)
        st.raf = 0
        window.clearTimeout(st.idle)
      }
    }
  }

  useEffect(() => {
    const c = ctrl.current as ShelfScroll & { _bind?: () => () => void }
    const unbind = c._bind?.() ?? (() => {})
    c.sync()
    return unbind
  }, [])

  return ctrl.current
}
