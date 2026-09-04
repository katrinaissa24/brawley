/** The inside of the front cover: title (click to edit page 0) and date (click opens the date picker). */
import { useStore } from '@/model/store'
import type { Entry } from '@/model/types'
import { S } from '@/copy/strings'
import { formatLong } from '@/lib/dates'
import { flip } from './flip'
import { bookRegistry } from './registry'

export function Endpaper({ entry }: { entry: Entry }) {
  const title = entry.title.trim()
  const onTitle = () => {
    const face = bookRegistry.faces.get(0)
    if (face) void flip.openEditor(face, entry.id, 0)
    else useStore.getState().openPage(entry.id, 0)
  }
  const onDate = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    useStore.getState().openPopover({ kind: 'date', entryId: entry.id, anchor: { x: r.left, y: r.top, w: r.width, h: r.height } })
  }
  return (
    <div className="ob__ep">
      <div
        className={'ob__epTitle' + (title ? '' : ' -empty')}
        role="button"
        tabIndex={0}
        title={S.book.editTitle}
        onClick={e => { e.stopPropagation(); onTitle() }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onTitle() } }}
      >
        {title || S.book.untitled}
      </div>
      <button
        type="button"
        className="ob__epDate"
        title={S.book.changeDate}
        onClick={e => { e.stopPropagation(); onDate(e) }}
        onPointerDown={e => e.stopPropagation()}
      >
        {formatLong(entry.date)}
      </button>
    </div>
  )
}
