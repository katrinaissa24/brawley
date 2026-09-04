/** Small Apple-like controls used by the chrome popovers: Switch, Segmented, Slider, icons. */
import { useId, type ReactNode } from 'react'
import { sound } from '@/feel/sound'

export function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.checked}
      aria-label={p.label}
      className="ui-switch"
      onClick={() => { p.onChange(!p.checked); sound.snap() }}
    />
  )
}

export function Segmented<T extends string>(p: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  wide?: boolean
}) {
  const i = Math.max(0, p.options.findIndex(o => o.value === p.value))
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = p.options[(i + d + p.options.length) % p.options.length]
    p.onChange(next.value)
    sound.snap()
    ;(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[(i + d + p.options.length) % p.options.length])?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label={p.label}
      className={`ui-seg${p.wide ? ' ui-seg--wide' : ''}`}
      style={{ ['--n' as string]: p.options.length, ['--i' as string]: i }}
      onKeyDown={onKey}
    >
      <span className="ui-seg__thumb" aria-hidden="true" />
      {p.options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === p.value}
          tabIndex={o.value === p.value ? 0 : -1}
          className="ui-seg__opt"
          onClick={() => { if (o.value !== p.value) { p.onChange(o.value); sound.snap() } }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider(p: { value: number; onChange: (v: number) => void; onRelease?: (v: number) => void; label: string; min?: number; max?: number }) {
  const min = p.min ?? 0
  const max = p.max ?? 100
  const pct = ((p.value - min) / (max - min)) * 100
  const id = useId()
  return (
    <div className="ui-slider">
      <input
        id={id}
        type="range"
        className="ui-range"
        min={min}
        max={max}
        step={1}
        value={p.value}
        aria-label={p.label}
        style={{ ['--p' as string]: `${pct}%` }}
        onChange={e => p.onChange(Number(e.currentTarget.value))}
        onPointerUp={e => p.onRelease?.(Number(e.currentTarget.value))}
        onKeyUp={e => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') p.onRelease?.(Number(e.currentTarget.value)) }}
      />
      <span className="ui-slider__value" aria-hidden="true">{Math.round(p.value)}</span>
    </div>
  )
}

export function Row(p: { label: string; children: ReactNode }) {
  return (
    <div className="ui-row">
      <span className="ui-row__label">{p.label}</span>
      {p.children}
    </div>
  )
}
export function Section(p: { title: string; children: ReactNode }) {
  return (
    <section className="ui-section" aria-label={p.title}>
      <h4 className="ui-section__title">{p.title}</h4>
      {p.children}
    </section>
  )
}

/* ---------- icons (15px line icons, currentColor) ---------- */
const svg = (d: ReactNode, vb = '0 0 16 16') => (
  <svg viewBox={vb} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
export const Icon = {
  chevronLeft: () => svg(<path d="M10 3 5 8l5 5" />),
  chevronRight: () => svg(<path d="m6 3 5 5-5 5" />),
  chevronDown: () => svg(<path d="m3 6 5 5 5-5" />),
  search: () => svg(<><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>),
  close: () => svg(<path d="m4 4 8 8M12 4l-8 8" />),
  gear: () => svg(<><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2" /></>),
  picture: () => svg(<><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="5.5" cy="6.5" r="1" /><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2L14 12" /></>),
  keyboard: () => svg(<><rect x="1.5" y="4" width="13" height="8" rx="1.5" /><path d="M4 7h1M7 7h1M10 7h1M4 9.5h8" /></>),
}
