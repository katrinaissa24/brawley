/**
 * The table of contents, on the inside of the front cover: the first thing a book shows when it
 * opens. Chapters in page order, the entries that open inside each of them underneath, and the
 * page each one starts on. None of it is stored — contentsOf reads it back out of the pages every
 * time, so a title typed on a page turns up here the moment it is written. A row turns the book
 * to its page.
 */
import { useMemo } from 'react'
import { S } from '@/copy/strings'
import { contentsOf } from '@/model/contents'
import { spreadOfPage, type Entry } from '@/model/types'
import { bookRegistry } from './registry'

/** How many lines the inside cover has room for before it starts counting instead. */
const ROWS = 15

interface Row { kind: 'chapter' | 'entry'; key: string; title: string; page: number; muted: boolean }

export function Contents({ entry }: { entry: Entry }) {
  const rows = useMemo(() => {
    const list = contentsOf(entry)
    // a book nobody has broken into chapters is just its entries; the heading would be noise
    const named = list.length > 1 || !!list[0]?.chapter.title.trim()
    const out: Row[] = []
    for (const c of list) {
      if (named) out.push({ kind: 'chapter', key: 'c' + c.chapter.id, title: c.chapter.title.trim() || S.book.untitledChapter(c.index + 1), page: c.start, muted: !c.chapter.title.trim() })
      for (const e of c.entries) out.push({ kind: 'entry', key: 'e' + e.page, title: e.title, page: e.page, muted: false })
    }
    return out
  }, [entry])

  const shown = rows.slice(0, ROWS)
  const more = rows.length - shown.length
  const turn = (page: number) => { void bookRegistry.ctl?.flipTo(spreadOfPage(page)) }

  return (
    <div className="ob__toc" aria-label={S.book.a11y.contents}>
      <div className="ob__tocHead">{S.book.contents}</div>
      {shown.length === 0 && <div className="ob__tocEmpty">{S.book.contentsEmpty}</div>}
      <ol className="ob__tocList">
        {shown.map(r => (
          <li key={r.key} className="ob__tocRow" data-kind={r.kind}>
            <button
              type="button"
              className={'ob__tocLink' + (r.muted ? ' -muted' : '')}
              title={S.book.a11y.goToPage(r.page + 1)}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); turn(r.page) }}
            >
              <span className="ob__tocText">{r.title}</span>
              <span className="ob__tocLeader" aria-hidden="true" />
              <span className="ob__tocPage">{r.page + 1}</span>
            </button>
          </li>
        ))}
      </ol>
      {more > 0 && <div className="ob__tocMore">+{more}</div>}
    </div>
  )
}
