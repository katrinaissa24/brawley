/**
 * Wrap-mode picker: a radiogroup of four icon buttons (Auto / Break / Behind / Front) whose icons
 * are tiny diagrams of text lines around a box. Keys 1–4 are bound by ImageToolbar while mounted;
 * the tooltips here advertise them.
 */
import { S } from '@/copy/strings'
import type { WrapMode } from '@/model/types'
import './editor-chrome.css'

export const WRAP_MODES = ['auto', 'break', 'behind', 'front'] as const
export type PickableWrapMode = (typeof WRAP_MODES)[number]

export interface WrapPickerProps {
  value: WrapMode
  onChange(m: WrapMode): void
}

/** 'left' / 'right' are forced-side variants of auto; the picker shows them as Auto. */
const shown = (value: WrapMode): PickableWrapMode => (value === 'left' || value === 'right' ? 'auto' : value)

export function WrapPicker({ value, onChange }: WrapPickerProps) {
  const current = shown(value)
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = WRAP_MODES.indexOf(current)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % WRAP_MODES.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + WRAP_MODES.length) % WRAP_MODES.length
    if (next < 0) return
    e.preventDefault()
    onChange(WRAP_MODES[next])
    const btn = (e.currentTarget.children[next] as HTMLElement | undefined)
    btn?.focus()
  }
  return (
    <div
      className="ed-wrap"
      role="radiogroup"
      aria-label={S.editorChrome.wrap.label}
      onKeyDown={onKeyDown}
      onMouseDown={e => e.preventDefault()}
    >
      {WRAP_MODES.map((m, i) => {
        const checked = current === m
        return (
          <button
            key={m}
            type="button"
            className="ed-wrap__btn ed-chrome-btn"
            role="radio"
            aria-checked={checked}
            aria-label={S.editorChrome.wrap[m]}
            data-tip={`${S.editorChrome.wrap[m]} · ${i + 1}`}
            data-mode={m}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(m)}
          >
            <WrapIcon mode={m} />
          </button>
        )
      })}
    </div>
  )
}

/** 18×18 diagrams; lines are text, the box is the picture. */
export function WrapIcon({ mode }: { mode: PickableWrapMode }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 18 18',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
  }
  switch (mode) {
    case 'auto':
      return (
        <svg {...common}>
          <path d="M2.5 3h13M2.5 15.5h13" />
          <rect x="2.5" y="6" width="6" height="6.5" rx="1" />
          <path d="M11.5 7h4M11.5 9.5h4M11.5 12h4" />
        </svg>
      )
    case 'break':
      return (
        <svg {...common}>
          <path d="M2.5 3h13M2.5 15.5h13" />
          <rect x="4.5" y="6" width="9" height="6.5" rx="1" />
        </svg>
      )
    case 'behind':
      return (
        <svg {...common}>
          <rect x="4" y="3" width="10" height="12" rx="1" strokeOpacity="0.45" fill="currentColor" fillOpacity="0.12" />
          <path d="M2.5 5h13M2.5 8.5h13M2.5 12h13" />
        </svg>
      )
    case 'front':
      return (
        <svg {...common}>
          <path d="M2.5 3.5h13M2.5 7h13M2.5 10.5h13M2.5 14h13" strokeOpacity="0.55" />
          <rect x="5" y="4.5" width="8" height="9" rx="1" fill="var(--ed-capsule-solid)" />
        </svg>
      )
  }
}
