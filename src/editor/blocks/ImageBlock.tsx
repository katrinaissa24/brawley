/**
 * ImageBlock — `div.ed-block[data-type=image]` with --x/--y/--w/--h (+ --rot, --radius, --op).
 * The picture paints the cached thumb immediately and swaps to the full blob only once it has
 * decoded (no blank frame, no blur filter). Non-natural frames crop (object-fit: cover) instead of
 * stretching. z layer comes from the wrap mode via data-wrap (behind 0 · wrapping 20 · front 30).
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useImageUrl } from '@/lib/db'
import { PITCH, type ImageBlock as ImageBlockT } from '@/model/types'
import { S } from '@/copy/strings'
import type { EditorSession } from '../session'
import { useEntrance } from './useEntrance'

export interface ImageBlockProps {
  block: ImageBlockT
  quality: 'thumb' | 'full'
  session: EditorSession | null
  selected: boolean
}

export const ImageBlockView = memo(function ImageBlockView({ block, quality, session, selected }: ImageBlockProps) {
  const ref = useRef<HTMLDivElement>(null)
  const id = block.id
  const thumb = useImageUrl(block.imageId, 'thumb')
  const full = useImageUrl(quality === 'full' ? block.imageId : undefined, 'full')
  const [decoded, setDecoded] = useState('')

  // swap to the full blob only once it is decoded, so the thumb never flashes to blank
  useEffect(() => {
    if (!full) { setDecoded(''); return }
    let alive = true
    const im = new Image()
    im.src = full
    const done = () => { if (alive) setDecoded(full) }
    im.decode().then(done, done)
    return () => { alive = false }
  }, [full])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !session) return
    session.els.set(id, el)
    session.emit('blocksChanged')
    return () => { session.els.delete(id); session.emit('blocksChanged') }
  }, [session, id])

  useEntrance(ref, session, id)

  const src = decoded || thumb
  const opacity = block.opacity ?? (block.wrapMode === 'behind' ? 0.7 : 1)
  const pos = block.objectPosition
  const style = {
    '--x': block.x * PITCH + 'px',
    '--y': block.y * PITCH + 'px',
    '--w': block.w * PITCH + 'px',
    '--h': block.h * PITCH + 'px',
    '--rot': block.rotation ? block.rotation + 'deg' : undefined,
    '--radius': (block.cornerRadius ?? 0) + 'px',
    '--op': opacity,
  } as React.CSSProperties

  return (
    <div
      ref={ref}
      className="ed-block ed-block--image"
      data-id={id}
      data-type="image"
      data-wrap={block.wrapMode}
      data-frame={block.frame === 'polaroid' ? 'polaroid' : undefined}
      data-selected={selected || undefined}
      data-loading={src ? undefined : '1'}
      style={style}
      role={session ? 'img' : undefined}
      aria-label={session ? block.alt || S.editor.a11y.imageBlock : undefined}
    >
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
