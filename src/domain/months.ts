import { riyadhLocalToInstant, riyadhToday } from './operational-day'

/** Calendar-month helpers (Riyadh). Month keys look like "2026-09". */
export function isMonthKey(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function monthFirstDay(month: string): string {
  return `${month}-01`
}

export function monthLastDay(month: string): string {
  const d = new Date(`${nextMonth(month)}-01T00:00:00Z`)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

/** [start, end) instants of a Riyadh calendar month. */
export function monthInstants(month: string): { start: Date; end: Date } {
  return { start: riyadhLocalToInstant(monthFirstDay(month), '00:00'), end: riyadhLocalToInstant(monthFirstDay(nextMonth(month)), '00:00') }
}

export function currentMonth(now: Date = new Date()): string {
  return monthOf(riyadhToday(now))
}
