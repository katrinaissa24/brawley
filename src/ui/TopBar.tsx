/**
 * The quiet top bar: transparent at rest, items as paper capsules.
 * Left: wordmark on the shelf; Back + breadcrumb (+ autosave dot, page number) when a book/page is open.
 * Right: Search, Today, Settings. Also mounts the popovers and binds the chrome's global keys.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEntry, useStore } from '@/model/store'
import type { Entry } from '@/model/types'
import { journalFile } from '@/lib/journalFile'
import { shelfApi } from '@/library/shelfApi'
import { flip } from '@/book/flip'
import { S } from '@/copy/strings'
import { SearchField, type SearchHandle } from './SearchField'
import { Popovers } from './Popovers'
import { rectOf } from './Popover'
import { Icon } from './controls'
import { useGlobalKeys, type GlobalKeyHandlers } from './keys'
import { hourPlaceholder, runLength, todayEntryId, yearsAgo } from './today'
import './ui.css'

const TODAY_OPEN_DELAY = 220

export function TopBar() {
  const route = useStore(s => s.route)
  const entry = useEntry(route.view === 'shelf' ? null : route.entryId)
  const saveState = useStore(s => s.saveState)
  const popover = useStore(s => s.popover)
  const entries = useStore(s => s.entries)
  const order = useStore(s => s.order)
  const journal = useStore(s => s.journal)
  const search = useRef<SearchHandle>(null)
  const gear = useRef<HTMLButtonElement>(null)
  const todayBtn = useRef<HTMLButtonElement>(null)

  const todayId = useMemo(() => todayEntryId(entries, order), [entries, order])
  const run = useMemo(() => runLength(entries), [entries])
  const ago = useMemo(() => yearsAgo(entries), [entries])

  const handlers = useMemo<GlobalKeyHandlers>(() => ({
    newEntry() {
      const s = useStore.getState()
      const e = s.createEntry()
      s.openPage(e.id, 0)
    },
    focusSearch() { search.current?.focus() },
    openSettings() {
      const s = useStore.getState()
      if (s.popover?.kind === 'settings') s.closePopover()
      else s.openPopover({ kind: 'settings', anchor: rectOf(gear.current) })
    },
    toggleShortcuts() {
      const s = useStore.getState()
      if (s.popover?.kind === 'shortcuts') s.closePopover()
      else s.openPopover({ kind: 'shortcuts' })
    },
    reopenLastClosed() {
      const s = useStore.getState()
      const id = s.lastClosedEntryId
      if (id && s.entries[id] && s.route.view === 'shelf') s.openBook(id)
    },
    today() {
      const s = useStore.getState()
      const id = todayEntryId(s.entries, s.order)
      if (!id) {
        const e = s.createEntry()
        s.openPage(e.id, 0)
        return
      }
      if (s.route.view === 'shelf' && shelfApi.impl) {
        // show where it lives first, then open it
        shelfApi.impl.scrollToEntry(id)
        window.setTimeout(() => {
          const st = useStore.getState()
          if (st.route.view === 'shelf' && st.entries[id]) st.openBook(id)
        }, TODAY_OPEN_DELAY)
      } else s.openBook(id)
    },
    canToday() {
      const s = useStore.getState()
      return s.route.view === 'shelf' && !s.popover
    },
    isBusy() { return !!useStore.getState().popover },
    saveJournal() {
      const j = useStore.getState().journal
      if (j.mode !== 'download' && j.mode !== 'folder') return
      void journalFile.save().then(() => { if (j.mode === 'download') useStore.getState().toast(S.ui.settings.saved(j.name ?? '')) })
    },
  }), [])
  useGlobalKeys(handlers)

  const T = S.ui.topbar
  const onBack = () => {
    if (route.view === 'editor') void flip.closeEditor()
    else useStore.getState().back()
  }
  const crumb = entry ? entry.title.trim() : ''
  const tip = todayId ? S.ui.today.open : S.ui.today.start
  const note = run >= 2 ? S.ui.today.run(run) : ago ? S.ui.today.yearsAgo(ago) : ''

  return (
    <>
      <header className="ui-topbar" data-view={route.view} aria-label={S.ui.a11y.topbar}>
        <div className="ui-topbar__side ui-topbar__side--left">
          {route.view === 'shelf' ? (
            <button type="button" className="ui-wordmark" title={T.frontPage} aria-label={T.frontPage} onClick={() => useStore.getState().setFront(true)}>
              {T.wordmark}
            </button>
          ) : (
            <>
              <button type="button" className="ui-capsule ui-back" onClick={onBack}>
                <Icon.chevronLeft />
                <span>{route.view === 'editor' ? T.backToBook : T.back}</span>
              </button>
              {entry && (route.view === 'editor'
                // in the editor this is the journal's own name, and the only place to write it:
                // the title above the page belongs to the chapter
                ? <BookName entry={entry} />
                : (
                  <span className={`ui-crumb${crumb ? ' ui-crumb--title' : ''}`} title={crumb || undefined}>
                    {crumb || T.placeholder[hourPlaceholder()]}
                  </span>
                ))}
              {route.view !== 'editor' && <SaveDot state={saveState} />}
            </>
          )}
        </div>

        <div className="ui-topbar__side ui-topbar__side--right">
          {journal.mode === 'download' && (
            <button
              type="button"
              className="ui-capsule ui-save"
              data-unsaved={journal.unsaved || undefined}
              title={journal.unsaved ? S.ui.settings.saveUnsavedTip : S.ui.settings.saveTip}
              onClick={handlers.saveJournal}
            >
              <span className="ui-save__dot" aria-hidden="true" />
              <span>{S.ui.settings.save}</span>
            </button>
          )}
          <SearchField ref={search} />
          <span className="ui-tipwrap ui-tipwrap--right">
            <button
              ref={todayBtn}
              type="button"
              className="ui-capsule ui-today"
              data-has={todayId ? 'true' : 'false'}
              aria-label={tip}
              aria-describedby={note ? 'ui-today-note' : undefined}
              onClick={handlers.today}
            >
              <span className="ui-today__dot" aria-hidden="true" />
              <span>{S.ui.today.label}</span>
            </button>
            <span className="ui-tip" role="tooltip">
              {tip}
              {note && <span className="ui-tip__note" id="ui-today-note">{note}</span>}
            </span>
          </span>
          <button
            ref={gear}
            type="button"
            className="ui-capsule ui-capsule--icon"
            data-popover-trigger
            aria-label={T.settings}
            aria-haspopup="dialog"
            aria-expanded={popover?.kind === 'settings'}
            onClick={handlers.openSettings}
          >
            <Icon.gear />
          </button>
        </div>
      </header>
      <Popovers />
    </>
  )
}

/** 6px autosave dot: invisible at rest, ring while pending, pulse while saving, fills then fades; accent on failure (click retries). */
function SaveDot({ state }: { state: 'idle' | 'pending' | 'saving' | 'saved' | 'failed' }) {
  const V = S.ui.save
  const label = state === 'pending' ? V.pending : state === 'saving' ? V.saving : state === 'saved' ? V.saved : state === 'failed' ? V.failed : ''
  if (state === 'failed') {
    return (
      <button
        type="button"
        className="ui-savedot"
        data-state={state}
        title={`${V.failed} · ${V.retry}`}
        aria-label={`${V.failed}. ${V.retry}`}
        onClick={() => void useStore.getState().flushSave()}
      />
    )
  }
  return <span className="ui-savedot" data-state={state} title={label || undefined} role="status" aria-label={label || undefined} />
}

/**
 * The journal's name, in the corner of the page editor. Debounced like every other field here:
 * the store coalesces the keystrokes into one undo step.
 */
function BookName({ entry }: { entry: Entry }) {
  const [value, setValue] = useState(entry.title)
  const typing = useRef(false)
  const timer = useRef(0)
  useEffect(() => { if (!typing.current) setValue(entry.title) }, [entry.title])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const commit = (v: string) => {
    window.clearTimeout(timer.current)
    const e = useStore.getState().entries[entry.id]
    if (!e || e.title === v) return
    useStore.getState().updateEntry(entry.id, en => ({ ...en, title: v }), { coalesce: 'title' })
  }
  return (
    <input
      data-book-name
      className={'ui-crumb ui-crumb--field' + (value.trim() ? ' ui-crumb--title' : '')}
      value={value}
      size={Math.max(10, Math.min(30, value.length + 1))}
      placeholder={S.editor.bookPlaceholder}
      aria-label={S.editor.a11y.bookName}
      title={value.trim() || undefined}
      spellCheck
      onChange={e => {
        const v = e.target.value
        setValue(v)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => commit(v), 300)
      }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commit(value); e.currentTarget.blur() } }}
      onFocus={() => { typing.current = true }}
      onBlur={() => { typing.current = false; commit(value) }}
    />
  )
}
