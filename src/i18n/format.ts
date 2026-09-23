import { operationalDateOf, riyadhParts, BUSINESS_TIMEZONE } from '@/domain/operational-day'
import type { Halalas } from '@/domain/money'
import type { Locale } from './types'

/**
 * Formatting rules (docs/DECISIONS.md): Gregorian calendar in both languages, Latin digits,
 * 12-hour clock, always in Asia/Riyadh regardless of the device timezone.
 */
const INTL_LOCALE: Record<Locale, string> = {
  ar: 'ar-SA-u-ca-gregory-nu-latn',
  en: 'en-US-u-ca-gregory-nu-latn',
}

export function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale]
}

export function formatNumber(value: number, locale: Locale, fractionDigits = 0): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/** 14700 → "147 ر.س" / "SAR 147"; shows halalas only when present. */
export function formatMoney(amount: Halalas, locale: Locale): string {
  const digits = amount % 100 === 0 ? 0 : 2
  const n = formatNumber(amount / 100, locale, digits)
  return locale === 'ar' ? `${n} ر.س` : `SAR ${n}`
}

function fmt(locale: Locale, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: BUSINESS_TIMEZONE, ...options })
}

/** "الخميس، 1 أكتوبر 2026" / "Thursday, October 1, 2026" */
export function formatDate(value: Date, locale: Locale): string {
  return fmt(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(value)
}

/** A calendar date string (YYYY-MM-DD) without timezone shifting. */
export function formatCalendarDate(date: string, locale: Locale, withWeekday = true): string {
  const d = new Date(`${date}T12:00:00+03:00`)
  return fmt(locale, { ...(withWeekday ? { weekday: 'long' as const } : {}), year: 'numeric', month: 'long', day: 'numeric' }).format(d)
}

export function formatTime(value: Date, locale: Locale): string {
  return fmt(locale, { hour: 'numeric', minute: '2-digit', hour12: true }).format(value)
}

/** Short date + time, e.g. for tables and logs. */
export function formatDateTime(value: Date, locale: Locale): string {
  return fmt(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(value)
}

/**
 * Describes an appointment time clearly, flagging times after midnight with the
 * operational day they belong to (spec §2, §11).
 */
export function describeAppointment(value: Date, locale: Locale) {
  const opDate = operationalDateOf(value)
  const calendarDate = riyadhParts(value).date
  return {
    date: formatDate(value, locale),
    time: formatTime(value, locale),
    operationalDate: opDate,
    afterMidnight: opDate !== calendarDate,
    operationalDateLabel: formatCalendarDate(opDate, locale),
  }
}
