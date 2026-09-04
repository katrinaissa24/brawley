/**
 * Image toolbar: a paper capsule floating 6px below the selected picture with the wrap picker,
 * corner-radius toggle (0 / 8 / 16), an opacity slider (only for 'behind'), the polaroid frame
 * toggle, Replace and Remove. Appears 60ms after mount (never during a gesture — the core
 * mounts it once the selection settles). Keys 1–4 set the wrap mode while mounted.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { S } from '@/copy/strings'
import type { ImageBlock, Rect } from '@/model/types'
import { FloatingCapsule, Glyph, tip } from './BubbleToolbar'
import { WRAP_MODES, WrapPicker } from './WrapPicker'
import './editor-chrome.css'

export interface ImageToolbarProps {
  block: ImageBlock
  /** Viewport rect of the selected picture. */
  anchor: Rect
  /** Patch the block. Opacity slider calls this rAF-throttled — coalesce it (e.g. key `image-opacity:<id>`). */
  onChange(patch: Partial<ImageBlock>): void
  onReplace(): void
  onRemove(): void
}

const RADII = [0, 8, 16] as const
const nextRadius = (r: number) => RADII[(Math.max(0, RADII.indexOf(r as 0 | 8 | 16)) + 1) % RADII.length]

export function ImageToolbar({ block, anchor, onChange, onReplace, onRemove }: ImageToolbarProps) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 60)
    return () => window.clearTimeout(t)
  }, [])

  // 1–4 → wrap mode, while mounted (ignored while typing in a field or editable)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const i = ['1', '2', '3', '4'].indexOf(e.key)
      if (i < 0) return
      e.preventDefault()
      onChangeRef.current({ wrapMode: WRAP_MODES[i] })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!shown) return null

  const C = S.editorChrome.image
  const radius = block.cornerRadius ?? 0
  const polaroid = block.frame === 'polaroid'
  const behind = block.wrapMode === 'behind'

  return (
    <FloatingCapsule anchor={anchor} place="below" gap={6} className="ed-imgtb" role="toolbar" label={C.label} allowInputFocus>
      <WrapPicker value={block.wrapMode} onChange={m => onChange({ wrapMode: m })} />
      <span className="ed-chrome-sep" aria-hidden="true" />
      <button
        type="button"
        className="ed-imgtb__btn ed-chrome-btn"
        aria-label={C.corners}
        data-tip={C.cornersValue(radius)}
        data-radius={radius}
        onClick={() => onChange({ cornerRadius: nextRadius(radius) })}
      >
        <CornerGlyph radius={radius} />
      </button>
      <button
        type="button"
        className={'ed-imgtb__btn ed-chrome-btn' + (polaroid ? ' is-active' : '')}
        aria-label={C.polaroid}
        aria-pressed={polaroid}
        data-tip={C.polaroid}
        onClick={() => onChange({ frame: polaroid ? 'none' : 'polaroid' })}
      >
        <Glyph>
          <rect x="3" y="2.5" width="12" height="13.5" rx="1" />
          <rect x="5" y="4.5" width="8" height="7" rx=".5" fill="currentColor" fillOpacity=".18" />
        </Glyph>
      </button>
      {behind && <OpacitySlider key={block.id} value={block.opacity ?? 0.7} onChange={v => onChange({ opacity: v })} />}
      <span className="ed-chrome-sep" aria-hidden="true" />
      <button type="button" className="ed-imgtb__btn ed-chrome-btn" aria-label={C.replace} data-tip={C.replace} onClick={onReplace}>
        <Glyph>
          <rect x="2.5" y="3" width="13" height="12" rx="1.5" />
          <path d="M2.5 12.5 6.5 8.5l3 3 2-2 4 4" />
          <circle cx="11.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
        </Glyph>
      </button>
      <button type="button" className="ed-imgtb__btn ed-imgtb__btn--danger ed-chrome-btn" aria-label={C.remove} data-tip={C.remove} onClick={onRemove}>
        <Glyph>
          <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5M7.6 7.5v5M10.4 7.5v5" />
        </Glyph>
      </button>
    </FloatingCapsule>
  )
}

function CornerGlyph({ radius }: { radius: number }) {
  // the visible corner arc grows with the radius so the button reads the current value
  const r = radius === 0 ? 0.5 : radius === 8 ? 4 : 7
  return (
    <Glyph>
      <path d={`M3.5 15.5V${3.5 + r}A${r} ${r} 0 0 1 ${3.5 + r} 3.5H15.5`} />
      <path d="M8.5 15.5h7M15.5 8.5v7" strokeOpacity=".4" />
    </Glyph>
  )
}

/** Uncontrolled range (smooth while dragging); React's onChange fires per input event, so it is the single
 *  rAF-throttled path to onChange. Syncs from `value` when it changes externally (undo). */
function OpacitySlider({ value, onChange }: { value: number; onChange(v: number): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const raf = useRef(0)
  const pending = useRef(value)
  const dragging = useRef(false)
  useLayoutEffect(() => {
    if (!dragging.current && ref.current) ref.current.value = String(value)
  }, [value])
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current) }, [])
  const push = (v: number) => {
    pending.current = v
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      onChange(pending.current)
    })
  }
  /** Deliver the last value now (on release), cancelling the pending frame. */
  const flush = () => {
    if (!raf.current) return
    cancelAnimationFrame(raf.current)
    raf.current = 0
    onChange(pending.current)
  }
  const C = S.editorChrome.image
  return (
    <label className="ed-imgtb__opacity" data-tip={C.opacity}>
      <Glyph size={16}>
        <circle cx="9" cy="9" r="6" />
        <path d="M9 3a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" fillOpacity=".5" />
      </Glyph>
      <input
        ref={ref}
        type="range"
        className="ed-imgtb__range"
        min={0.15}
        max={1}
        step={0.01}
        defaultValue={value}
        aria-label={C.opacity}
        onPointerDown={() => { dragging.current = true }}
        onPointerUp={() => { dragging.current = false; flush() }}
        onPointerCancel={() => { dragging.current = false; flush() }}
        onChange={e => push(Number(e.target.value))}
        onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    </label>
  )
}
