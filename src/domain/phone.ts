import { normalizeDigits } from './money'

/**
 * Normalize a phone number to E.164 (e.g. "+966501234567").
 * Saudi local formats are accepted: 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, 009665XXXXXXXX.
 * Other countries must be entered with + or 00 and their country code.
 * Returns null when the number cannot be normalized confidently.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  let s = normalizeDigits(input).replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (/^05\d{8}$/.test(s)) return `+966${s.slice(1)}`
  if (/^5\d{8}$/.test(s)) return `+966${s}`
  if (/^9665\d{8}$/.test(s)) return `+${s}`
  if (/^\+9660/.test(s)) s = `+966${s.slice(5)}` // "+966 05..." typo
  if (s.startsWith('+966')) return /^\+966\d{9}$/.test(s) ? s : null
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s
  return null
}

/** Digits only, as required by https://wa.me/<number>. */
export function waNumber(e164: string): string {
  return e164.replace(/^\+/, '')
}
