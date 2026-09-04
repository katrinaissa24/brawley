/**
 * Book3D — one closed 5-face box driven entirely by CSS variables. Memoized; never re-renders on
 * scroll or hover (the shelf writes data-hover / --breathe / --pick on the element through the registry).
 * Faces: spine (z = 0, faces the camera), front cover (x = spine-w side), back cover (x = 0 side),
 * top edge (y = 0), and one radial-gradient shadow face lying on the plank. The box extends from
 * z = 0 back to z = -160 (BOOK.depth). No opacity / box-shadow / filter on the root, ever.
 */
import { memo, type CSSProperties } from 'react'
import type { Entry, Id } from '@/model/types'
import { HUES, INK, coverHex, inkFor } from '@/model/palette'
import { useImageUrl } from '@/lib/db'
import { S } from '@/copy/strings'
import { GHOST_ID, jitter } from './layout'

export type BookState = 'match' | 'dim' | undefined

export interface Book3DProps {
  entry: Entry
  x: number
  w: number
  /** search: 'match' lifts, 'dim' recedes and colour-mixes toward the wall */
  state?: BookState
  /** an entry from exactly n years ago today: a ribbon peeks above the spine */
  ribbon?: boolean
  register: (id: Id, el: HTMLElement | null) => void
}

function coverPair(entry: Entry): [string, string] {
  const c = coverHex(entry.cover)
  const deeper = HUES[entry.cover.hue][Math.min(2, entry.cover.tint + 1) as 0 | 1 | 2]
  return [c, entry.cover.tint === 2 ? c : deeper]
}

export const Book3D = memo(function Book3D({ entry, x, w, state, ribbon, register }: Book3DProps) {
  const [cover, cover2] = coverPair(entry)
  const ink = inkFor(cover)
  const img = useImageUrl(entry.cover.imageId, 'thumb')
  const title = entry.title.trim() || S.shelf.untitled
  const spine = entry.cover.spine
  const spineText = spine === 'blank' ? '' : spine === 'initial' ? title.slice(0, 1).toUpperCase() : title
  const style = {
    '--x': `${x}px`,
    '--spine-w': `${w}px`,
    '--bk-cover-base': cover,
    '--bk-cover-2-base': cover2,
    '--bk-ink-base': INK[ink],
    '--bk-ink-light': INK.light,
    '--jz': `${(jitter(entry.id) * 0.35).toFixed(3)}deg`,
  } as CSSProperties
  return (
    <div
      className="book"
      data-finish={entry.cover.finish}
      data-thin={w < 14 || undefined}
      data-spine={spine}
      data-match={state === 'match' || undefined}
      data-dim={state === 'dim' || undefined}
      style={style}
      ref={el => register(entry.id, el)}
      aria-hidden="true"
    >
      <div className="book__face book__spine">
        {spineText && <span className="book__spineTitle">{spineText}</span>}
        {ribbon && <span className="book__ribbon" />}
      </div>
      <div className="book__face book__cover -front">
        {img && <img src={img} alt="" draggable={false} decoding="async" />}
        {entry.title.trim() && (
          <div className={'book__title' + (img ? ' -plain' : ' -band')}>{entry.title.trim()}</div>
        )}
      </div>
      <div className="book__face book__cover -back" />
      <div className="book__face book__top" />
      <div className="book__face book__shadow" />
    </div>
  )
})

/** The dashed "New entry" slot at the right end; pops like a real book. */
export const GhostBook = memo(function GhostBook({ x, w, register }: { x: number; w: number; register: (id: Id, el: HTMLElement | null) => void }) {
  const style = { '--x': `${x}px`, '--spine-w': `${w}px`, '--jz': '0deg' } as CSSProperties
  return (
    <div className="book book--ghost" style={style} ref={el => register(GHOST_ID, el)} aria-hidden="true">
      <div className="book__face book__spine"><span className="book__plus" /></div>
      <div className="book__face book__cover -front" />
      <div className="book__face book__top" />
      <div className="book__face book__shadow" />
    </div>
  )
})
