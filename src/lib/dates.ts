import type { ISODate } from '@/model/types'

const pad = (n: number) => String(n).padStart(2, '0')
export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const todayISO = () => toISODate(new Date())
export function parseISO(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const monthKey = (iso: ISODate) => iso.slice(0, 7)
export const yearOf = (iso: ISODate) => iso.slice(0, 4)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function monthLabel(key: string, withYear = true) {
  const [y, m] = key.split('-').map(Number)
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1]
}
/** 'Wednesday, 3 September 2026' */
export function formatLong(iso: ISODate) {
  const d = parseISO(iso)
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
/** '3 Sep' */
export function formatShort(iso: ISODate) {
  const d = parseISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}
/** 'Tue 3' */
export function formatDay(iso: ISODate) {
  const d = parseISO(iso)
  return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()}`
}
export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}
export function addYears(iso: ISODate, n: number): ISODate {
  const d = parseISO(iso)
  d.setFullYear(d.getFullYear() + n)
  return toISODate(d)
}
export function daysBetween(a: ISODate, b: ISODate) {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)
}
export function isEvening() {
  const h = new Date().getHours()
  return h >= 19 || h < 6
}
