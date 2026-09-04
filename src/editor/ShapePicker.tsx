/**
 * Picture-shape picker: a radiogroup of four cut-outs (Square / Rounded / Circle / Heart) drawn as
 * the shape itself, so the button is the preview. "Rounded" is the same rect shape with a radius —
 * clicking it while it is already current steps the radius 8 → 16 → 24 → 8.
 */
import { S } from '@/copy/strings'
import type { ImageShape } from '@/model/types'
import './editor-chrome.css'

export const SHAPE_KEYS = ['square', 'rounded', 'circle', 'heart'] as const
export type ShapeKey = (typeof SHAPE_KEYS)[number]
export const RADII = [8, 16, 24] as const

/** The stored (shape, cornerRadius) pair, read as one of the four buttons. */
export function shapeKey(shape: ImageShape | undefined, radius: number | undefined): ShapeKey {
  if (shape === 'circle' || shape === 'heart') return shape
  return radius && radius > 0 ? 'rounded' : 'square'
}
export const nextRadius = (r: number) => RADII[(RADII.indexOf(r as 8 | 16 | 24) + 1) % RADII.length]

export interface ShapePickerProps {
  value: ShapeKey
  radius: number
  onChange(patch: { shape: ImageShape; cornerRadius: number }): void
}

export function ShapePicker({ value, radius, onChange }: ShapePickerProps) {
  const pick = (k: ShapeKey) => {
    if (k === 'square') onChange({ shape: 'rect', cornerRadius: 0 })
    else if (k === 'rounded') onChange({ shape: 'rect', cornerRadius: value === 'rounded' ? nextRadius(radius) : RADII[0] })
    else onChange({ shape: k, cornerRadius: 0 })
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = SHAPE_KEYS.indexOf(value)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % SHAPE_KEYS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + SHAPE_KEYS.length) % SHAPE_KEYS.length
    if (next < 0) return
    e.preventDefault()
    pick(SHAPE_KEYS[next])
    ;(e.currentTarget.children[next] as HTMLElement | undefined)?.focus()
  }
  const C = S.editorChrome.image
  return (
    <div
      className="ed-wrap"
      role="radiogroup"
      aria-label={C.shape}
      onKeyDown={onKeyDown}
      onMouseDown={e => e.preventDefault()}
    >
      {SHAPE_KEYS.map(k => {
        const checked = value === k
        const label = C.shapes[k]
        return (
          <button
            key={k}
            type="button"
            className="ed-wrap__btn ed-chrome-btn"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            data-tip={k === 'rounded' ? C.cornersValue(checked ? radius : 0) : label}
            tabIndex={checked ? 0 : -1}
            onClick={() => pick(k)}
          >
            <ShapeIcon shape={k} radius={checked ? radius : RADII[0]} />
          </button>
        )
      })}
    </div>
  )
}

const HEART_D =
  'M9 15.6C9 15.6 2.2 11.4 2.2 6.6 2.2 4.3 3.9 2.7 5.9 2.7 7.3 2.7 8.4 3.5 9 4.6 9.6 3.5 10.7 2.7 12.1 2.7 14.1 2.7 15.8 4.3 15.8 6.6 15.8 11.4 9 15.6 9 15.6Z'

function ShapeIcon({ shape, radius }: { shape: ShapeKey; radius: number }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true } as const
  if (shape === 'heart') {
    return (
      <svg {...common}>
        <path d={HEART_D} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="currentColor" fillOpacity=".16" />
      </svg>
    )
  }
  if (shape === 'circle') {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="6.4" stroke="currentColor" strokeWidth="1.4" fill="currentColor" fillOpacity=".16" />
      </svg>
    )
  }
  // square / rounded share the rect; the drawn radius tracks the current value so the button reads it
  const rx = shape === 'square' ? 0.5 : Math.min(6, radius / 4 + 1)
  return (
    <svg {...common}>
      <rect x="2.6" y="2.6" width="12.8" height="12.8" rx={rx} stroke="currentColor" strokeWidth="1.4" fill="currentColor" fillOpacity=".16" />
    </svg>
  )
}
