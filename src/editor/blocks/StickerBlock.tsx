/**
 * StickerBlock — `div.ed-block[data-type=sticker]` with --x/--y/--w/--h/--rot/--op. Stickers are
 * always in the front layer (z 30) and never take part in wrap. Artwork comes from Sticker.tsx
 * (chrome module); the date stamp reads the entry's date. New stickers pop in 0.6 → 1 on the
 * wobbly spring (useEntrance, via session.justAdded).
 */
import { memo, useLayoutEffect, useRef } from 'react'
import { PITCH, type Entry, type StickerBlock as StickerBlockT } from '@/model/types'
import { S } from '@/copy/strings'
import { Sticker } from '../Sticker'
import type { EditorSession } from '../session'
import { useEntrance } from './useEntrance'

export interface StickerBlockProps {
  block: StickerBlockT
  entry: Entry
  session: EditorSession | null
  selected: boolean
}

export const StickerBlockView = memo(function StickerBlockView({ block, entry, session, selected }: StickerBlockProps) {
  const ref = useRef<HTMLDivElement>(null)
  const id = block.id

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !session) return
    session.els.set(id, el)
    session.emit('blocksChanged')
    return () => { session.els.delete(id); session.emit('blocksChanged') }
  }, [session, id])

  useEntrance(ref, session, id, 0.6)

  const style = {
    '--x': block.x * PITCH + 'px',
    '--y': block.y * PITCH + 'px',
    '--w': block.w * PITCH + 'px',
    '--h': block.h * PITCH + 'px',
    '--rot': (block.rotation ?? 0) + 'deg',
    '--op': block.opacity ?? 1,
  } as React.CSSProperties

  return (
    <div
      ref={ref}
      className="ed-block ed-block--sticker"
      data-id={id}
      data-type="sticker"
      data-selected={selected || undefined}
      data-flip={block.flipX ? 'x' : undefined}
      style={style}
      role={session ? 'img' : undefined}
      aria-label={session ? S.editor.a11y.stickerBlock : undefined}
    >
      <div className="ed-sticker-art">
        <Sticker source={block.source} entry={entry} w={block.w} h={block.h} />
      </div>
    </div>
  )
})
