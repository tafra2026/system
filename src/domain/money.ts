import { DomainError } from './errors'

/**
 * All money is stored and computed as integer halalas (1 SAR = 100 halalas).
 * Rounding policy (fixed, documented in docs/DECISIONS.md): round half-up to the
 * nearest halala, applied only when a percentage or division produces a fraction.
 */
export type Halalas = number

export const HALALAS_PER_SAR = 100

export function assertHalalas(value: number, field = 'amount'): Halalas {
  if (!Number.isSafeInteger(value)) throw new DomainError('money_not_integer', { field })
  return value
}

export function assertNonNegative(value: Halalas, field = 'amount'): Halalas {
  assertHalalas(value, field)
  if (value < 0) throw new DomainError('money_negative', { field })
  return value
}

/** Convert an SAR amount with at most 2 decimals to halalas (e.g. 249.99 -> 24999). */
export function sar(amount: number): Halalas {
  const scaled = Math.round(amount * HALALAS_PER_SAR)
  if (!Number.isFinite(amount) || Math.abs(scaled - amount * HALALAS_PER_SAR) > 1e-6) {
    throw new DomainError('money_invalid')
  }
  return scaled
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹'

/** Replace Arabic-Indic digits and the Arabic decimal separator with ASCII. */
export function normalizeDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    const a = ARABIC_INDIC.indexOf(ch)
    const e = EASTERN_ARABIC_INDIC.indexOf(ch)
    if (a >= 0) out += String(a)
    else if (e >= 0) out += String(e)
    else if (ch === '٫') out += '.'
    else if (ch === '٬') out += ''
    else out += ch
  }
  return out
}

/**
 * Parse user input in SAR ("196", "196.5", "١٩٦٫٥") into halalas.
 * Returns null for empty/invalid input or more than 2 decimals.
 */
export function parseSarInput(input: string | null | undefined): Halalas | null {
  if (input == null) return null
  const s = normalizeDigits(String(input)).replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  const value = Number(whole) * HALALAS_PER_SAR + Number(frac.padEnd(2, '0'))
  return Number.isSafeInteger(value) ? value : null
}

/** amount * basisPoints / 10000, rounded half-up. 2500 bp = 25%. */
export function percentOf(amount: Halalas, basisPoints: number): Halalas {
  assertNonNegative(amount)
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    throw new DomainError('percent_invalid')
  }
  return Math.floor((amount * basisPoints + 5000) / 10000)
}

/**
 * Split `total` into `parts` integer shares that sum exactly to `total`.
 * The rounding remainder goes to the earliest shares (documented policy).
 */
export function splitEvenly(total: Halalas, parts: number): Halalas[] {
  assertNonNegative(total)
  if (!Number.isInteger(parts) || parts <= 0) throw new DomainError('split_invalid')
  const base = Math.floor(total / parts)
  const remainder = total - base * parts
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0))
}

export function sum(values: readonly Halalas[]): Halalas {
  return values.reduce((a, b) => a + b, 0)
}

/** Plain decimal string for inputs/exports: 14700 -> "147.00". */
export function toSarString(amount: Halalas): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
