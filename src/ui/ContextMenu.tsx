/** Book context menu: Open, Edit page 1, Cover…, Change date…, Duplicate, Remove (undo toast). */
import { useEffect, useRef } from 'react'
import type { Block, Entry, Id, Rect } from '@/model/types'
import { useEntry, useStore } from '@/model/store'
import { db } from '@/lib/db'
import { nanoid } from '@/lib/ids'
import { shelfApi } from '@/library/shelfApi'
import { sound } from '@/feel/sound'
import { S } from '@/copy/strings'
import { Popover } from './Popover'

interface Item { key: string; label: string; run: () => void; danger?: boolean; sep?: boolean }

export function ContextMenu({ entryId, anchor }: { entryId: Id; anchor: Rect }) {
  const entry = useEntry(entryId)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { useStore.getState().setActiveEntry(entryId) }, [entryId])
  useEffect(() => { if (!entry) useStore.getState().closePopover() }, [entry])
  if (!entry) return null

  const s = useStore.getState
  const close = () => s().closePopover()
  const C = S.ui.context
  const items: Item[] = [
    { key: 'open', label: C.open, run: () => { close(); s().openBook(entryId) } },
    { key: 'edit', label: C.editPage, run: () => { close(); s().openPage(entryId, 0) } },
    { key: 'cover', label: C.cover, run: () => s().openPopover({ kind: 'cover', entryId, anchor }) },
    { key: 'date', label: C.changeDate, run: () => s().openPopover({ kind: 'date', entryId, anchor }) },
    { key: 'dup', label: C.duplicate, run: () => { close(); void duplicateEntry(entryId) } },
    { key: 'remove', label: C.remove, danger: true, sep: true, run: () => { close(); removeEntry(entryId) } },
  ]

  const onKeyDown = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0
    if (!d) return
    e.preventDefault()
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (!els.length) return
    const i = els.indexOf(document.activeElement as HTMLElement)
    const n = d === -Infinity ? 0 : d === Infinity ? els.length - 1 : (i + d + els.length) % els.length
    els[n].focus()
  }

  return (
    <Popover anchor={anchor} side="bottom" align="start" label={S.ui.a11y.menu} role="menu" className="ui-menu-pop">
      <div ref={ref} className="ui-menu" onKeyDown={onKeyDown}>
        {items.map(it => (
          <div key={it.key}>
            {it.sep && <div className="ui-menu__sep" role="separator" />}
            <button
              type="button"
              role="menuitem"
              className={`ui-menu__item${it.danger ? ' ui-menu__item--danger' : ''}`}
              onClick={it.run}
            >
              {it.label}
            </button>
          </div>
        ))}
      </div>
    </Popover>
  )
}

/* ---------- actions (also usable by other modules) ---------- */

/** Soft-delete with a 10s undo toast; the store hard-deletes after the window. */
export function removeEntry(id: Id) {
  const s = useStore.getState()
  if (!s.entries[id]) return
  s.deleteEntry(id)
  sound.whump()
  s.toast(S.ui.context.removed, { undo: () => useStore.getState().restoreEntry(id), ms: 10000 })
}

/** Copy an entry (pages, cover, pictures) as a new book beside it, dated the same day. */
export async function duplicateEntry(id: Id): Promise<Entry | null> {
  const s = useStore.getState()
  const src = s.entries[id]
  if (!src) return null
  const copy = s.createEntry(src.date)

  // pictures belong to an entry (db.deleteEntry removes them by entryId), so the copy gets its own
  const wanted = new Set<Id>()
  if (src.cover.imageId) wanted.add(src.cover.imageId)
  for (const p of src.pages) for (const b of p.blocks) if (b.type === 'image') wanted.add(b.imageId)
  const map = new Map<Id, Id>()
  for (const imgId of wanted) {
    try {
      const rec = await db.getImage(imgId)
      if (!rec) continue
      const nid = nanoid(12)
      await db.putImage({ ...rec, id: nid, entryId: copy.id, createdAt: Date.now() })
      map.set(imgId, nid)
    } catch (err) {
      console.warn('picture not copied', err)
    }
  }
  const pages = src.pages.map(p => ({
    id: nanoid(),
    blocks: p.blocks.map((b): Block => {
      const nb: Block = { ...b, id: nanoid() }
      return nb.type === 'image' ? { ...nb, imageId: map.get(nb.imageId) ?? nb.imageId } : nb
    }),
  }))
  const coverImage = src.cover.imageId ? map.get(src.cover.imageId) : undefined
  useStore.getState().updateEntry(
    copy.id,
    e => ({
      ...e,
      title: src.title ? src.title + S.ui.context.copySuffix : '',
      pages,
      cover: { ...src.cover, imageId: coverImage },
      lastOpenedPage: 0,
    }),
    { silent: true },
  )
  const st = useStore.getState()
  st.toast(S.ui.context.duplicated, { undo: () => useStore.getState().deleteEntry(copy.id) })
  shelfApi.impl?.scrollToEntry(copy.id)
  return st.entries[copy.id] ?? null
}
