/** Today / writing-rhythm helpers for the Today pill (pure, computed from entries). */
import type { Entry, Id } from '@/model/types'
import { todayISO, addDays, addYears } from '@/lib/dates'

export function todayEntryId(entries: Record<Id, Entry>, order: Id[]): Id | null {
  const t = todayISO()
  for (const id of order) if (entries[id]?.date === t) return id
  return null
}

/**
 * Length of the run of consecutive days with an entry, counting today when it exists,
 * otherwise the run that would continue if today were written (so the note reads as an invitation).
 * 0/1 mean "no run" (the copy table returns '' for those).
 */
export function runLength(entries: Record<Id, Entry>): number {
  const dates = new Set<string>()
  for (const e of Object.values(entries)) dates.add(e.date)
  const today = todayISO()
  let n = 0
  let d = today
  if (!dates.has(today)) { d = addDays(today, -1); n = 1 } // the run today would extend
  while (dates.has(d)) { n++; d = addDays(d, -1) }
  return n === 1 ? 0 : n
}

/** Years back (1..3) for which an entry exists exactly on this day, smallest first; empty if none. */
export function yearsAgo(entries: Record<Id, Entry>): number | null {
  const dates = new Set<string>()
  for (const e of Object.values(entries)) dates.add(e.date)
  const today = todayISO()
  for (let n = 1; n <= 3; n++) if (dates.has(addYears(today, -n))) return n
  return null
}

export function hourPlaceholder(): 'morning' | 'afternoon' | 'night' {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'night'
}
