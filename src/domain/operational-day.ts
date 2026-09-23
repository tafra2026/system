/**
 * Operational day rules (spec §11):
 * - Timezone Asia/Riyadh (UTC+3 all year; Saudi Arabia has no DST).
 * - Bookings open at 14:00; the last allowed service START is 03:00 the next morning.
 * - A start at exactly 03:00 belongs to the PREVIOUS operational day (declared decision).
 * - Services may END after 03:00; late services are never auto-closed.
 */
export const BUSINESS_TIMEZONE = 'Asia/Riyadh'
export const RIYADH_UTC_OFFSET = '+03:00'

export interface OperatingHours {
  /** Minutes after local midnight when bookings open (default 14:00). */
  openMinutes: number
  /** Minutes after local midnight of the last allowed start on the next morning (default 03:00). */
  lastStartMinutes: number
}

export const DEFAULT_OPERATING_HOURS: OperatingHours = { openMinutes: 14 * 60, lastStartMinutes: 3 * 60 }

export interface LocalParts {
  date: string // YYYY-MM-DD
  hour: number
  minute: number
  second: number
  millisecond: number
}

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function riyadhParts(instant: Date): LocalParts {
  const map: Record<string, string> = {}
  for (const p of partsFormatter.formatToParts(instant)) map[p.type] = p.value
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    millisecond: instant.getUTCMilliseconds(),
  }
}

/** Add days to a YYYY-MM-DD calendar date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Milliseconds since local midnight. */
function localMs(p: LocalParts): number {
  return ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + p.millisecond
}

/**
 * The operational date an instant belongs to. Anything from local midnight up to and
 * INCLUDING the last-start boundary (03:00:00.000) belongs to the previous calendar date.
 */
export function operationalDateOf(instant: Date, hours: OperatingHours = DEFAULT_OPERATING_HOURS): string {
  const p = riyadhParts(instant)
  return localMs(p) <= hours.lastStartMinutes * 60_000 ? addDays(p.date, -1) : p.date
}

/** True if a service may START at this instant (14:00 … 03:00 next day, inclusive). */
export function isAllowedStartTime(instant: Date, hours: OperatingHours = DEFAULT_OPERATING_HOURS): boolean {
  const ms = localMs(riyadhParts(instant))
  return ms >= hours.openMinutes * 60_000 || ms <= hours.lastStartMinutes * 60_000
}

/** Build an instant from a Riyadh wall-clock date + "HH:mm". */
export function riyadhLocalToInstant(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new RangeError('invalid local date/time')
  }
  const d = new Date(`${date}T${time}:00${RIYADH_UTC_OFFSET}`)
  if (Number.isNaN(d.getTime())) throw new RangeError('invalid local date/time')
  return d
}

/**
 * Instant range covered by an operational date: (D 03:00, D+1 03:00] in Riyadh time.
 * Use `start < t AND t <= end` in queries.
 */
export function operationalDayBounds(
  operationalDate: string,
  hours: OperatingHours = DEFAULT_OPERATING_HOURS,
): { startExclusive: Date; endInclusive: Date } {
  const hh = String(Math.floor(hours.lastStartMinutes / 60)).padStart(2, '0')
  const mm = String(hours.lastStartMinutes % 60).padStart(2, '0')
  return {
    startExclusive: riyadhLocalToInstant(operationalDate, `${hh}:${mm}`),
    endInclusive: riyadhLocalToInstant(addDays(operationalDate, 1), `${hh}:${mm}`),
  }
}

/** Today's calendar date in Riyadh. */
export function riyadhToday(now: Date = new Date()): string {
  return riyadhParts(now).date
}

/** First day (YYYY-MM-01) of the Riyadh month containing `now`. */
export function riyadhMonthStart(now: Date = new Date()): string {
  return `${riyadhParts(now).date.slice(0, 7)}-01`
}
