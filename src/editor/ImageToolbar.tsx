/**
 * Image toolbar: a paper capsule floating 6px below the selected picture with the wrap picker, the
 * shape picker (square / rounded / circle / heart), a reframe toggle that turns drags inside the
 * picture into panning (plus a zoom slider while it is on), an opacity slider (only for 'behind'),
 * the polaroid frame toggle, for a video the autoplay / click-to-play toggle, Replace and Remove. Appears 60ms after mount (never during a gesture —
 * the core mounts it once the selection settles). Keys 1–4 set the wrap mode while mounted.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { S } from '@/copy/strings'
import { IMAGE_ZOOM, type ImageBlock, type ImageShape, type Rect } from '@/model/types'
import { FloatingCapsule, Glyph } from './BubbleToolbar'
import { ShapePicker, shapeKey } from './ShapePicker'
import { WRAP_MODES, WrapPicker } from './WrapPicker'
import './editor-chrome.css'

export interface ImageToolbarProps {
  block: ImageBlock
  /** Viewport rect of the selected picture. */
  anchor: Rect
  /** Patch the block. Sliders call this rAF-throttled — coalesce it (e.g. key `image-opacity:<id>`). */
  onChange(patch: Partial<ImageBlock>): void
  onReplace(): void
  onRemove(): void
  /** true while this picture is the store's cropping target */
  reframing: boolean
  onReframe(on: boolean): void
}

export function ImageToolbar({ block, anchor, onChange, onReplace, onRemove, reframing, onReframe }: ImageToolbarProps) {
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
  const shape = block.shape ?? 'rect'
  const key = shapeKey(shape, radius)
  const polaroid = block.frame === 'polaroid'
  const behind = block.wrapMode === 'behind'
  const video = block.media === 'video'
  const auto = (block.playback ?? 'auto') === 'auto'
  const V = C.video

  /** Circle and heart read as themselves only in a square frame, so squaring up comes with them. */
  const onShape = (patch: { shape: ImageShape; cornerRadius: number }) => {
    const square = patch.shape !== 'rect' && block.w !== block.h
    onChange({
      ...patch,
      cornerRadius: patch.cornerRadius || undefined,
      ...(patch.shape !== 'rect' ? { frame: 'none' as const } : null),
      ...(square ? { h: block.w } : null),
    })
  }

  return (
    <FloatingCapsule anchor={anchor} place="below" gap={6} className="ed-imgtb" role="toolbar" label={video ? V.label : C.label} allowInputFocus>
      <WrapPicker value={block.wrapMode} onChange={m => onChange({ wrapMode: m })} />
      <span className="ed-chrome-sep" aria-hidden="true" />
      <ShapePicker value={key} radius={radius || 8} onChange={onShape} />
      <span className="ed-chrome-sep" aria-hidden="true" />
      <button
        type="button"
        className={'ed-imgtb__btn ed-chrome-btn' + (reframing ? ' is-active' : '')}
        aria-label={C.reframe}
        aria-pressed={reframing}
        data-tip={reframing ? C.reframeOn : C.reframe}
        onClick={() => onReframe(!reframing)}
      >
        <Glyph>
          <rect x="2.5" y="2.5" width="13" height="13" rx="1.5" strokeDasharray="2.6 2" />
          <path d="M9 5.4v7.2M5.4 9h7.2M9 5.4 7.5 7M9 5.4 10.5 7M9 12.6 7.5 11M9 12.6l1.5-1.6M5.4 9 7 7.5M5.4 9 7 10.5M12.6 9 11 7.5M12.6 9 11 10.5" />
        </Glyph>
      </button>
      {reframing && (
        <ZoomSlider key={block.id + ':zoom'} value={block.objectScale ?? 1} onChange={v => onChange({ objectScale: v === 1 ? undefined : v })} />
      )}
      {!reframing && (
        <button
          type="button"
          className={'ed-imgtb__btn ed-chrome-btn' + (polaroid ? ' is-active' : '')}
          aria-label={C.polaroid}
          aria-pressed={polaroid}
          data-tip={C.polaroid}
          disabled={shape !== 'rect'}
          onClick={() => onChange({ frame: polaroid ? 'none' : 'polaroid' })}
        >
          <Glyph>
            <rect x="3" y="2.5" width="12" height="13.5" rx="1" />
            <rect x="5" y="4.5" width="8" height="7" rx=".5" fill="currentColor" fillOpacity=".18" />
          </Glyph>
        </button>
      )}
      {video && !reframing && (
        <button
          type="button"
          className="ed-imgtb__btn ed-chrome-btn ed-imgtb__play"
          aria-label={auto ? V.autoplay : V.clickToPlay}
          data-tip={auto ? V.autoplay : V.clickToPlay}
          onClick={() => onChange({ playback: auto ? 'click' : 'auto' })}
        >
          {auto ? (
            <Glyph>
              <path d="M3 9a6 6 0 0 1 10.3-4.2M15 9a6 6 0 0 1-10.3 4.2" />
              <path d="M13.6 2.2v2.9h-2.9M4.4 15.8v-2.9h2.9" />
              <path d="M7.6 6.8v4.4L11.2 9z" fill="currentColor" stroke="none" />
            </Glyph>
          ) : (
            <Glyph>
              <circle cx="9" cy="9" r="6.5" />
              <path d="M7.5 6.3v5.4L11.8 9z" fill="currentColor" stroke="none" />
            </Glyph>
          )}
          <span className="ed-imgtb__playlabel">{auto ? V.short.auto : V.short.click}</span>
        </button>
      )}
      {behind && !reframing && <OpacitySlider key={block.id} value={block.opacity ?? 0.7} onChange={v => onChange({ opacity: v })} />}
      <span className="ed-chrome-sep" aria-hidden="true" />
      <button type="button" className="ed-imgtb__btn ed-chrome-btn" aria-label={video ? V.replace : C.replace} data-tip={video ? V.replace : C.replace} onClick={onReplace}>
        <Glyph>
          <rect x="2.5" y="3" width="13" height="12" rx="1.5" />
          <path d="M2.5 12.5 6.5 8.5l3 3 2-2 4 4" />
          <circle cx="11.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
        </Glyph>
      </button>
      <button type="button" className="ed-imgtb__btn ed-imgtb__btn--danger ed-chrome-btn" aria-label={video ? V.remove : C.remove} data-tip={video ? V.remove : C.remove} onClick={onRemove}>
        <Glyph>
          <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5M7.6 7.5v5M10.4 7.5v5" />
        </Glyph>
      </button>
    </FloatingCapsule>
  )
}

function OpacitySlider({ value, onChange }: { value: number; onChange(v: number): void }) {
  const C = S.editorChrome.image
  return (
    <Slider value={value} min={0.15} max={1} step={0.01} label={C.opacity} onChange={onChange}>
      <circle cx="9" cy="9" r="6" />
      <path d="M9 3a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" fillOpacity=".5" />
    </Slider>
  )
}

function ZoomSlider({ value, onChange }: { value: number; onChange(v: number): void }) {
  const C = S.editorChrome.image
  return (
    <Slider value={value} min={IMAGE_ZOOM.min} max={IMAGE_ZOOM.max} step={0.02} label={C.zoom} onChange={onChange}>
      <circle cx="8" cy="8" r="5" />
      <path d="m11.8 11.8 3.4 3.4M6 8h4M8 6v4" />
    </Slider>
  )
}

/** Uncontrolled range (smooth while dragging); React's onChange fires per input event, so it is the single
 *  rAF-throttled path to onChange. Syncs from `value` when it changes externally (undo). */
function Slider({ value, min, max, step, label, onChange, children }: {
  value: number
  min: number
  max: number
  step: number
  label: string
  onChange(v: number): void
  children: React.ReactNode
}) {
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
  return (
    <label className="ed-imgtb__opacity" data-tip={label}>
      <Glyph size={16}>{children}</Glyph>
      <input
        ref={ref}
        type="range"
        className="ed-imgtb__range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        aria-label={label}
        onPointerDown={() => { dragging.current = true }}
        onPointerUp={() => { dragging.current = false; flush() }}
        onPointerCancel={() => { dragging.current = false; flush() }}
        onChange={e => push(Number(e.target.value))}
        onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    </label>
  )
}
