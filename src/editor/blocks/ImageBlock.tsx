/**
 * ImageBlock — `div.ed-block[data-type=image]` with --x/--y/--w/--h (+ --rot, --radius, --op).
 * The picture paints whatever quality is cached immediately and swaps to a better one only once
 * that has decoded (no blank frame, no blur filter). Non-natural frames crop (object-fit: cover) instead of
 * stretching. z layer comes from the wrap mode via data-wrap (behind 0 · wrapping 20 · front 30).
 * data-shape cuts the frame (rounded rect · circle · heart). While the block is the store's
 * croppingBlockId a drag inside it pans the picture within that frame and the wheel zooms, both
 * written straight to the element and committed once on release — the block itself never moves.
 * A block with media 'video' paints a <video> in the same frame (so shapes, wrap and reframing all
 * apply) over its stored poster: 'auto' loops silently while on screen, 'click' shows a play button.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useImageUrl } from '@/lib/db'
import { useStore } from '@/model/store'
import { IMAGE_ZOOM, PITCH, type ImageBlock as ImageBlockT, type VideoPlayback } from '@/model/types'
import { S } from '@/copy/strings'
import { updateBlock } from '../ops'
import type { EditorSession } from '../session'
import { useEntrance } from './useEntrance'

export interface ImageBlockProps {
  block: ImageBlockT
  quality: 'thumb' | 'full'
  session: EditorSession | null
  selected: boolean
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

interface PanDrag {
  pointerId: number
  /** pointer position and framing point at the start of the gesture */
  x: number
  y: number
  pos: { x: number; y: number }
  travel: { x: number; y: number }
  next: { x: number; y: number } | null
}

/**
 * How far the picture can travel inside its frame, in px, per axis. object-fit: cover overflows by
 * whatever the aspect mismatch leaves over; the zoom adds (scale - 1) of the frame on top.
 */
function panTravel(block: ImageBlockT, boxW: number, boxH: number) {
  const nw = Math.max(1, block.naturalW)
  const nh = Math.max(1, block.naturalH)
  const cover = Math.max(boxW / nw, boxH / nh)
  const zoom = (block.objectScale ?? 1) - 1
  return {
    x: Math.max(0, nw * cover - boxW) + zoom * boxW,
    y: Math.max(0, nh * cover - boxH) + zoom * boxH,
  }
}

export const ImageBlockView = memo(function ImageBlockView({ block, quality, session, selected }: ImageBlockProps) {
  const ref = useRef<HTMLDivElement>(null)
  const id = block.id
  const video = block.media === 'video'
  const thumb = useImageUrl(block.imageId, 'thumb')
  // a video needs the file itself on every page it is shown on — the thumb is only its poster
  const full = useImageUrl(quality === 'full' || video ? block.imageId : undefined, 'full')
  const cropping = useStore(st => (session ? st.croppingBlockId === id : false))

  // The import publishes the original first and swaps in the thumb and the full-size copy as they
  // are made, so the source can change more than once: paint the first one at once, and every later
  // one only after it has decoded, so an upgrade never flashes an empty frame.
  const best = full || thumb
  const [src, setSrc] = useState('')
  const shown = useRef('')
  shown.current = src
  useEffect(() => {
    if (!best || video) { setSrc(''); return }
    if (!shown.current) { setSrc(best); return }
    let alive = true
    const im = new Image()
    im.src = best
    const done = () => { if (alive) setSrc(best) }
    im.decode().then(done, done)
    return () => { alive = false }
  }, [best, video])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !session) return
    session.els.set(id, el)
    session.emit('blocksChanged')
    return () => { session.els.delete(id); session.emit('blocksChanged') }
  }, [session, id])

  useEntrance(ref, session, id)

  /* ---------- pan / zoom inside the frame (only while this block is the cropping target) ---------- */
  const live = useRef(block)
  live.current = block
  const drag = useRef<PanDrag | null>(null)

  const paint = useCallback((pos: { x: number; y: number }, scale: number) => {
    const el = ref.current
    if (!el) return
    const img = el.querySelector<HTMLImageElement>('.ed-img')
    const ox = (pos.x * 100).toFixed(3) + '%'
    const oy = (pos.y * 100).toFixed(3) + '%'
    if (img) img.style.objectPosition = `${ox} ${oy}`
    el.style.setProperty('--img-ox', ox)
    el.style.setProperty('--img-oy', oy)
    el.style.setProperty('--img-scale', String(scale))
  }, [])

  const commitFrame = useCallback((patch: Partial<ImageBlockT>) => {
    if (!session) return
    session.commit(
      e => updateBlock<ImageBlockT>(e, session.pageIndex, id, b => ({ ...b, ...patch })),
      { coalesce: 'image-frame:' + id },
    )
  }, [session, id])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropping || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const scale = Math.max(0.01, r.width / Math.max(1, el.offsetWidth))
    const b = live.current
    drag.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      pos: b.objectPosition ?? { x: 0.5, y: 0.5 },
      travel: panTravel(b, el.offsetWidth * scale, el.offsetHeight * scale),
      next: null,
    }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    // dragging the picture right reveals what was off its left edge, so the framing point moves back
    const nx = d.travel.x > 0 ? clamp01(d.pos.x - (e.clientX - d.x) / d.travel.x) : d.pos.x
    const ny = d.travel.y > 0 ? clamp01(d.pos.y - (e.clientY - d.y) / d.travel.y) : d.pos.y
    d.next = { x: nx, y: ny }
    paint(d.next, live.current.objectScale ?? 1)
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    try { ref.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (d.next) commitFrame({ objectPosition: d.next })
  }
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!cropping) return
    e.preventDefault()
    e.stopPropagation()
    const b = live.current
    const next = Math.max(IMAGE_ZOOM.min, Math.min(IMAGE_ZOOM.max, (b.objectScale ?? 1) * (1 - e.deltaY * 0.0015)))
    paint(b.objectPosition ?? { x: 0.5, y: 0.5 }, next)
    commitFrame({ objectScale: next === 1 ? undefined : next })
  }

  const opacity = block.opacity ?? (block.wrapMode === 'behind' ? 0.7 : 1)
  const pos = block.objectPosition
  const shape = block.shape ?? 'rect'
  const style = {
    '--x': block.x * PITCH + 'px',
    '--y': block.y * PITCH + 'px',
    '--w': block.w * PITCH + 'px',
    '--h': block.h * PITCH + 'px',
    '--rot': block.rotation ? block.rotation + 'deg' : undefined,
    '--radius': shape === 'rect' ? (block.cornerRadius ?? 0) + 'px' : undefined,
    '--op': opacity,
    '--img-scale': block.objectScale && block.objectScale !== 1 ? block.objectScale : undefined,
    '--img-ox': pos ? pos.x * 100 + '%' : undefined,
    '--img-oy': pos ? pos.y * 100 + '%' : undefined,
  } as React.CSSProperties

  return (
    <div
      ref={ref}
      className="ed-block ed-block--image"
      data-id={id}
      data-type="image"
      data-wrap={block.wrapMode}
      data-shape={shape === 'rect' ? undefined : shape}
      data-frame={block.frame === 'polaroid' ? 'polaroid' : undefined}
      data-selected={selected || undefined}
      data-crop={cropping || undefined}
      data-loading={(video ? thumb || full : src) ? undefined : '1'}
      data-media={video ? 'video' : undefined}
      style={style}
      role={session && !video ? 'img' : undefined}
      aria-label={session ? block.alt || (video ? S.editorChrome.image.video.label : S.editor.a11y.imageBlock) : undefined}
      onPointerDown={cropping ? onPointerDown : undefined}
      onPointerMove={cropping ? onPointerMove : undefined}
      onPointerUp={cropping ? endDrag : undefined}
      onPointerCancel={cropping ? endDrag : undefined}
      onWheel={cropping ? onWheel : undefined}
    >
      {video && (
        <VideoFace src={full} poster={thumb} playback={block.playback ?? 'auto'} pos={pos} />
      )}
      {src && (
        <img
          className="ed-img"
          src={src}
          alt={block.alt ?? ''}
          draggable={false}
          decoding="async"
          style={pos ? { objectPosition: `${pos.x * 100}% ${pos.y * 100}%` } : undefined}
        />
      )}
    </div>
  )
})

/**
 * The moving picture. Playback is always started from script, never the autoplay attribute: the
 * book clones page DOM for its flip strips, and a cloned autoplay video would start on its own.
 * 'auto' plays muted and looped, and only while on screen; 'click' plays once with sound.
 */
function VideoFace({ src, poster, playback, pos }: { src: string; poster: string; playback: VideoPlayback; pos?: { x: number; y: number } }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const auto = playback === 'auto'
  const C = S.editorChrome.image.video

  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    v.muted = auto
    v.loop = auto
    if (!auto) { v.pause(); return }
    const io = new IntersectionObserver(([en]) => {
      if (en?.isIntersecting) void v.play().catch(() => { /* blocked or detached: the poster stays */ })
      else v.pause()
    })
    io.observe(v)
    return () => { io.disconnect(); v.pause() }
  }, [auto, src])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const v = ref.current
    if (!v) return
    if (!v.paused) { v.pause(); return }
    // if the browser won't allow sound yet, play silently rather than not at all
    v.muted = false
    void v.play().catch(() => { v.muted = true; return v.play() }).catch(() => {})
  }

  return (
    <>
      <video
        ref={ref}
        className="ed-img"
        src={src || undefined}
        poster={poster || undefined}
        playsInline
        muted
        preload={auto ? 'auto' : 'metadata'}
        disablePictureInPicture
        style={pos ? { objectPosition: `${pos.x * 100}% ${pos.y * 100}%` } : undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={e => { setPlaying(false); e.currentTarget.currentTime = 0 }}
      />
      {!auto && (
        <button
          type="button"
          className="ed-vid-play"
          data-media-control
          data-playing={playing || undefined}
          aria-label={playing ? C.pause : C.play}
          onPointerDown={e => e.stopPropagation()}
          onClick={toggle}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            {playing
              ? <path d="M8 6h2.6v12H8zM13.4 6H16v12h-2.6z" fill="currentColor" />
              : <path d="M8.5 5.8v12.4a.6.6 0 0 0 .9.5l9.7-6.2a.6.6 0 0 0 0-1L9.4 5.3a.6.6 0 0 0-.9.5z" fill="currentColor" />}
          </svg>
        </button>
      )}
    </>
  )
}
