import { describe, expect, it } from 'vitest'
import ar from '@/i18n/dictionaries/ar'
import en from '@/i18n/dictionaries/en'
import { createTranslator, translateError } from '@/i18n'
import { describeAppointment, formatDate, formatMoney, formatTime } from '@/i18n/format'
import { riyadhLocalToInstant } from '@/domain/operational-day'

type Tree = { [k: string]: string | Tree }
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else Object.assign(out, flatten(v, key))
  }
  return out
}
const flatAr = flatten(ar as unknown as Tree)
const flatEn = flatten(en as unknown as Tree)
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('i18n completeness (acceptance #1)', () => {
  it('both languages have exactly the same keys', () => {
    expect(Object.keys(flatEn).sort()).toEqual(Object.keys(flatAr).sort())
  })

  it('no empty messages', () => {
    for (const [k, v] of Object.entries({ ...flatAr, ...flatEn })) expect(v.trim(), k).not.toBe('')
  })

  it('the English interface contains no Arabic text', () => {
    for (const [k, v] of Object.entries(flatEn)) expect(ARABIC.test(v), `${k}: ${v}`).toBe(false)
  })

  it('placeholders match between languages', () => {
    for (const key of Object.keys(flatAr)) expect(placeholders(flatEn[key]!), key).toEqual(placeholders(flatAr[key]!))
  })

  it('directions are set per language', () => {
    expect(ar.meta.dir).toBe('rtl')
    expect(en.meta.dir).toBe('ltr')
  })

  it('translates nested keys with dots and interpolates', () => {
    const t = createTranslator('en')
    expect(t('audit.actions.salary.change')).toBe('Salary changed')
    expect(t('dashboard.greeting', { name: 'Mavlor' })).toBe('Hello Mavlor')
    expect(translateError(t, 'delivery_fee_out_of_range', { max: 30 })).toContain('30 SAR')
    expect(translateError(t, 'something_unknown')).toBe(en.errors.generic)
  })
})

describe('formatting', () => {
  it('uses Gregorian dates with Latin digits in Arabic', () => {
    const d = riyadhLocalToInstant('2026-10-01', '20:30')
    const text = formatDate(d, 'ar')
    expect(text).toContain('2026')
    expect(text).toContain('أكتوبر')
    expect(/[٠-٩]/.test(text)).toBe(false)
    expect(formatTime(d, 'en')).toBe('8:30 PM')
  })

  it('formats money in both languages', () => {
    expect(formatMoney(14700, 'en')).toBe('SAR 147')
    expect(formatMoney(14750, 'ar')).toBe('147.50 ر.س')
    expect(formatMoney(2240000, 'en')).toBe('SAR 22,400')
  })

  it('flags appointments after midnight with their operational day', () => {
    const a = describeAppointment(riyadhLocalToInstant('2026-10-02', '01:30'), 'en')
    expect(a.afterMidnight).toBe(true)
    expect(a.operationalDate).toBe('2026-10-01')
    expect(describeAppointment(riyadhLocalToInstant('2026-10-01', '22:00'), 'en').afterMidnight).toBe(false)
  })
})
