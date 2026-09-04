/**
 * Small month calendar for an entry's date. System font, 28px cells, ‹ › month nav, Today shortcut.
 * Picking commits via updateEntry (undoable) and toasts 'Moved to <Month YYYY>' with Undo when the month changed.
 */
import { useEffect, useRef, useState } from 'react'
import type { Id, ISODate, Rect } from '@/model/types'
import { useEntry, useStore } from '@/model/store'
import { addDays, formatLong, monthKey, monthLabel, parseISO, toISODate, todayISO } from '@/lib/dates'
import { sound } from '@/feel/sound'
import { S } from '@/copy/strings'
import { Popover } from './Popover'
import { Icon } from './controls'

const ROWS = 6
const shiftMonth = (key: string, n: number) => {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return monthKey(toISODate(d))
}

export function DatePicker({ entryId, anchor }: { entryId: Id; anchor: Rect }) {
  const entry = useEntry(entryId)
  const selected = entry?.date ?? todayISO()
  const [view, setView] = useState(() => monthKey(selected))
  const [focus, setFocus] = useState<ISODate>(selected)
  const grid = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(false)

  useEffect(() => { useStore.getState().setActiveEntry(entryId) }, [entryId])
  useEffect(() => { if (!entry) useStore.getState().closePopover() }, [entry])
  // keyboard travel: keep the focused day's button focused after the grid re-renders
  useEffect(() => {
    if (!wantFocus.current) return
    wantFocus.current = false
    grid.current?.querySelector<HTMLElement>(`[data-iso="${focus}"]`)?.focus()
  }, [focus, view])
  if (!entry) return null

  const today = todayISO()
  const D = S.ui.date
  const pick = (iso: ISODate) => {
    const prev = entry.date
    if (iso !== prev) {
      useStore.getState().updateEntry(entryId, e => ({ ...e, date: iso }))
      sound.snap()
      if (monthKey(iso) !== monthKey(prev)) {
        useStore.getState().toast(D.movedTo(monthLabel(monthKey(iso))), {
          undo: () => useStore.getState().updateEntry(entryId, e => ({ ...e, date: prev })),
        })
      }
    }
    useStore.getState().closePopover()
  }
  const go = (iso: ISODate) => {
    wantFocus.current = true
    setFocus(iso)
    const k = monthKey(iso)
    if (k !== view) setView(k)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key
    if (k === 'ArrowLeft') go(addDays(focus, -1))
    else if (k === 'ArrowRight') go(addDays(focus, 1))
    else if (k === 'ArrowUp') go(addDays(focus, -7))
    else if (k === 'ArrowDown') go(addDays(focus, 7))
    else if (k === 'PageUp') setView(v => shiftMonth(v, -1))
    else if (k === 'PageDown') setView(v => shiftMonth(v, 1))
    else if (k === 'Home') go(focus.slice(0, 8) + '01')
    else return
    e.preventDefault()
  }

  // Monday-first grid, 6 rows so the popover never changes height
  const [vy, vm] = view.split('-').map(Number)
  const first = new Date(vy, vm - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const start = addDays(toISODate(first), -lead)
  const days: ISODate[] = []
  for (let i = 0; i < ROWS * 7; i++) days.push(addDays(start, i))
  const focusVisible = days.includes(focus) ? focus : days.includes(selected) ? selected : days[lead]

  return (
    <Popover anchor={anchor} side="bottom" align="start" label={D.label} initialFocus={`[data-iso="${focusVisible}"]`}>
      <div className="ui-cal">
        <div className="ui-cal__head">
          <span className="ui-cal__month" aria-live="polite">{monthLabel(view)}</span>
          <div className="ui-cal__nav">
            <button type="button" aria-label={D.previousMonth} onClick={() => setView(v => shiftMonth(v, -1))}><Icon.chevronLeft /></button>
            <button type="button" aria-label={D.nextMonth} onClick={() => setView(v => shiftMonth(v, 1))}><Icon.chevronRight /></button>
          </div>
        </div>
        <div ref={grid} className="ui-cal__grid" role="grid" aria-label={S.ui.a11y.calendar} onKeyDown={onKeyDown}>
          {D.weekdays.map((w, i) => (
            <span key={i} className="ui-cal__dow" role="columnheader" aria-label={D.weekdaysLong[i]}>{w}</span>
          ))}
          {days.map(iso => {
            const d = parseISO(iso)
            const outside = monthKey(iso) !== view
            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                className="ui-cal__day"
                data-iso={iso}
                data-outside={outside || undefined}
                data-today={iso === today || undefined}
                aria-selected={iso === selected}
                aria-label={formatLong(iso)}
                tabIndex={iso === focusVisible ? 0 : -1}
                onClick={() => pick(iso)}
                onFocus={() => setFocus(iso)}
              >
                {d.getDate()}
              </button>
            )
          })}
        </div>
        <div className="ui-cal__foot">
          <span className="ui-cal__label" title={formatLong(entry.date)}>{formatLong(entry.date)}</span>
          <button type="button" className="ui-btn ui-btn--text" onClick={() => pick(today)}>{D.today}</button>
        </div>
      </div>
    </Popover>
  )
}
