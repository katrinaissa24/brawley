/**
 * LabelPill — the floating paper capsule above a hovered / focused / matching book.
 * Lives in the flat label layer (never inside the 3D subtree) so text stays crisp.
 * Two connector dots (::before / ::after) stagger in before the pill; exit is one 140ms fade.
 */
import { memo, type CSSProperties } from 'react'
import { S } from '@/copy/strings'

export interface Snippet { before: string; match: string; after: string }

export interface LabelPillProps {
  /** content x of the spine centre */
  cx: number
  title: string
  /** long date line ('Wednesday, 3 September 2026'); omitted for the ghost slot */
  date?: string
  /** 'A year ago today' */
  note?: string
  /** search snippet with the match in terracotta */
  snippet?: Snippet | null
  /** fading out (kept mounted for the exit) */
  out?: boolean
  /** keyboard focus: the accent ring is drawn on the pill, never around the 3D box */
  focus?: boolean
  /** quiet variant used for search matches (no pencil, no stagger) */
  compact?: boolean
  onCover?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

export const LabelPill = memo(function LabelPill(p: LabelPillProps) {
  const style = { '--cx': `${p.cx}px` } as CSSProperties
  return (
    <div
      className="shelf__label"
      data-out={p.out || undefined}
      data-focus={p.focus || undefined}
      data-compact={p.compact || undefined}
      style={style}
      onPointerEnter={p.onPointerEnter}
      onPointerLeave={p.onPointerLeave}
    >
      <div className="shelf__label__main">
        <div className="shelf__label__title">{p.title}</div>
        {p.date && <div className="shelf__label__date">{p.date}</div>}
        {p.note && <div className="shelf__label__note">{p.note}</div>}
        {p.snippet && (
          <div className="shelf__label__snippet">
            {p.snippet.before}<mark>{p.snippet.match}</mark>{p.snippet.after}
          </div>
        )}
      </div>
      {p.onCover && !p.compact && (
        <button
          type="button"
          className="shelf__label__pencil"
          aria-label={S.shelf.customize}
          title={S.shelf.customize}
          tabIndex={-1}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); p.onCover?.() }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4L6 12.4 2.8 13.2l.8-3.2 7.7-7.7Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
})
