/**
 * Folio sound engine — every sound is synthesized from AudioContext primitives (no files).
 * One context, master gain → compressor → destination. Rate gates + randomised timbre inside.
 * API is frozen (see DESIGN.md §6). Callers just call; the engine decides whether to play.
 */
import type { Settings } from '@/model/types'

class SoundEngine {
  ctx?: AudioContext
  private master!: GainNode
  private noise!: AudioBuffer
  private enabled = true
  private volume = 0.4
  private detentGain = 0.6 // soft
  private detentsOn = true
  private last: Record<string, number> = {}
  /** Fired on every detent (shelf spine crossing, snap) so a future native helper can add haptics. */
  readonly events = new EventTarget()

  /** Call on the first pointerdown/keydown (autoplay policy). Safe to call repeatedly. */
  init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume()
      return
    }
    const c = (this.ctx = new AudioContext({ latencyHint: 'interactive' }))
    const comp = c.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    comp.attack.value = 0.003
    comp.release.value = 0.1
    this.master = c.createGain()
    this.master.gain.value = this.enabled ? this.volume : 0.0001
    this.master.connect(comp).connect(c.destination)
    const n = Math.floor(c.sampleRate * 2)
    const buf = c.createBuffer(1, n, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    this.noise = buf
    // warm-up: a silent 50ms buffer so the first real sound has no latency
    const warm = c.createBufferSource()
    warm.buffer = buf
    const g = c.createGain()
    g.gain.value = 0
    warm.connect(g).connect(this.master)
    warm.start()
    warm.stop(c.currentTime + 0.05)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ctx?.state !== 'running') void this.ctx?.resume()
    })
  }
  apply(s: Settings) {
    this.enabled = s.sounds
    this.volume = s.soundVolume
    this.detentsOn = s.detents !== 'off'
    this.detentGain = s.detents === 'firm' ? 1 : 0.6
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0.0001, this.ctx.currentTime, 0.01)
  }
  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && this.enabled
  }
  private ok(name: string, gapMs: number) {
    if (!this.ready) return false
    const t = performance.now()
    if (t - (this.last[name] ?? -1e9) < gapMs) return false
    this.last[name] = t
    return true
  }
  private env(g: GainNode, t0: number, peak: number, a: number, d: number, hold = 0) {
    const p = g.gain
    p.setValueAtTime(0.0001, t0)
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a)
    p.setValueAtTime(Math.max(0.0002, peak), t0 + a + hold)
    p.exponentialRampToValueAtTime(0.0001, t0 + a + hold + d)
  }
  private rnd(v: number, pct: number) {
    return v * (1 + (Math.random() * 2 - 1) * pct)
  }
  private noiseSrc() {
    const s = this.ctx!.createBufferSource()
    s.buffer = this.noise
    s.loop = true
    s.loopStart = Math.random() * 1.5
    s.loopEnd = 2
    return s
  }
  private osc(type: OscillatorType, f0: number, f1: number, sweepS: number, t0: number, peak: number, a: number, d: number, out?: AudioNode) {
    const c = this.ctx!
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t0)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + sweepS)
    o.connect(g).connect(out ?? this.master)
    this.env(g, t0, peak, a, d)
    o.start(t0)
    o.stop(t0 + a + d + 0.02)
    return g
  }
  private burst(
    filters: { type: BiquadFilterType; f: number; q?: number }[],
    t0: number, peak: number, a: number, d: number, hold = 0,
    sweep?: (bp: BiquadFilterNode) => void,
  ) {
    const c = this.ctx!
    const n = this.noiseSrc()
    const g = c.createGain()
    let node: AudioNode = n
    filters.forEach((f, i) => {
      const b = c.createBiquadFilter()
      b.type = f.type
      b.frequency.value = this.rnd(f.f, 0.12)
      b.Q.value = f.q ?? 1
      if (i === 0 && sweep) sweep(b)
      node.connect(b)
      node = b
    })
    node.connect(g).connect(this.master)
    const dd = this.rnd(d, 0.1)
    this.env(g, t0, peak, a, dd, hold)
    n.start(t0)
    n.stop(t0 + a + hold + dd + 0.05)
  }

  /* ---- paper ---- */
  pageLift(gain = 1) {
    if (!this.ok('lift', 80)) return
    this.burst([{ type: 'bandpass', f: 1800, q: 0.9 }], this.ctx!.currentTime, 0.06 * gain, 0.012, 0.09)
  }
  pageLand(gain = 1, stretch = 1) {
    if (!this.ok('land', 80)) return
    const t = this.ctx!.currentTime
    this.burst([{ type: 'bandpass', f: 900, q: 1.2 }, { type: 'highpass', f: 400 }], t, 0.11 * gain, 0.006, 0.14 * stretch, 0.02, bp => {
      bp.frequency.linearRampToValueAtTime(2600, t + 0.06 * stretch)
      bp.frequency.exponentialRampToValueAtTime(600, t + 0.14 * stretch)
    })
    this.osc('sine', 140, 90, 0.06, t, 0.05 * gain, 0.004, 0.07)
  }
  coverOpen() { this.pageLand(0.9, 1.4) }
  coverClose() { this.pageLand(0.6, 1) }
  thump(kind: 'pickup' | 'open' | 'close') {
    if (!this.ok('thump', 150)) return
    const t = this.ctx!.currentTime
    if (kind === 'pickup') { this.osc('sine', 160, 110, 0.06, t, 0.06, 0.008, 0.12); return }
    const g = kind === 'close' ? 0.8 : 1
    this.osc('sine', 110, 60, 0.12, t, 0.14 * g, 0.008, 0.22)
    this.burst([{ type: 'lowpass', f: 500, q: 0.7 }], t, 0.05 * g, 0.01, 0.12)
  }
  shff() {
    if (!this.ok('shff', 120)) return
    this.burst([{ type: 'bandpass', f: 3000, q: 0.8 }], this.ctx!.currentTime, 0.02, 0.01, 0.06)
  }

  /* ---- ui ---- */
  /** Detent tick (shelf spine crossing). month=true adds the lower 'tock'. */
  tick(month = false) {
    this.events.dispatchEvent(new CustomEvent('detent', { detail: { month } }))
    if (!this.detentsOn) return
    if (!this.ok('tick', 45)) return
    const c = this.ctx!
    const t = c.currentTime
    const hp = c.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1200
    hp.connect(this.master)
    this.osc('triangle', 2400, 2400, 0, t, 0.045 * this.detentGain, 0.001, 0.028, hp)
    this.burst([{ type: 'bandpass', f: 4000, q: 2 }], t, 0.03 * this.detentGain, 0.001, 0.012)
    if (month) this.osc('sine', 620, 540, 0.04, t, 0.07, 0.002, 0.09)
  }
  snap() {
    this.events.dispatchEvent(new CustomEvent('detent', { detail: { snap: true } }))
    if (!this.detentsOn) return
    if (!this.ok('snap', 60)) return
    const t = this.ctx!.currentTime
    const f = this.rnd(1800, 0.03)
    this.osc('triangle', f, f, 0, t, 0.04 * this.detentGain, 0.001, 0.018)
    this.osc('sine', 320, 320, 0, t, 0.03 * this.detentGain, 0.001, 0.03)
  }
  whump() {
    if (!this.ok('whump', 150)) return
    this.burst([{ type: 'lowpass', f: 300 }], this.ctx!.currentTime, 0.04, 0.005, 0.1)
  }
  undo() {
    if (!this.ok('undo', 150)) return
    this.osc('sine', 500, 700, 0.06, this.ctx!.currentTime, 0.04, 0.003, 0.08)
  }
  chime() {
    if (!this.ok('chime', 20000)) return
    const c = this.ctx!
    const t = c.currentTime
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3000
    const delay = c.createDelay(0.5)
    delay.delayTime.value = 0.11
    const fb = c.createGain()
    fb.gain.value = 0.25
    const wet = c.createGain()
    wet.gain.value = 0.15
    delay.connect(fb).connect(delay)
    lp.connect(this.master)
    lp.connect(delay).connect(wet).connect(this.master)
    ;([[880, 0], [1318.5, 0.06]] as const).forEach(([f, dt]) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(g).connect(lp)
      this.env(g, t + dt, 0.05, 0.01, 0.6)
      o.start(t + dt)
      o.stop(t + dt + 0.7)
    })
  }
}
export const sound = new SoundEngine()
