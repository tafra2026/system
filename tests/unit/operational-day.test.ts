import { describe, expect, it } from 'vitest'
import {
  isAllowedStartTime,
  operationalDateOf,
  operationalDayBounds,
  riyadhLocalToInstant,
} from '@/domain/operational-day'

const at = (date: string, time: string) => riyadhLocalToInstant(date, time)

describe('operational day (spec §11)', () => {
  it('afternoon and evening belong to the same calendar date', () => {
    expect(operationalDateOf(at('2026-10-01', '14:00'))).toBe('2026-10-01')
    expect(operationalDateOf(at('2026-10-01', '23:59'))).toBe('2026-10-01')
  })

  it('after midnight belongs to the previous operational day', () => {
    expect(operationalDateOf(at('2026-10-02', '00:00'))).toBe('2026-10-01')
    expect(operationalDateOf(at('2026-10-02', '02:30'))).toBe('2026-10-01')
  })

  it('acceptance #17: 03:00 exactly belongs to the previous operational day and is allowed', () => {
    const start = at('2026-10-02', '03:00')
    expect(operationalDateOf(start)).toBe('2026-10-01')
    expect(isAllowedStartTime(start)).toBe(true)
    // A 60-minute service starting at 03:00 ends at 04:00; the end is not restricted.
    const end = new Date(start.getTime() + 60 * 60_000)
    expect(end.toISOString()).toBe('2026-10-02T01:00:00.000Z')
  })

  it('03:01 is not an allowed start; 13:59 not allowed; 14:00 allowed', () => {
    expect(isAllowedStartTime(at('2026-10-02', '03:01'))).toBe(false)
    expect(isAllowedStartTime(at('2026-10-02', '13:59'))).toBe(false)
    expect(isAllowedStartTime(at('2026-10-02', '14:00'))).toBe(true)
  })

  it('month boundary after midnight', () => {
    expect(operationalDateOf(at('2026-11-01', '01:00'))).toBe('2026-10-31')
  })

  it('computes query bounds for an operational day', () => {
    const b = operationalDayBounds('2026-10-01')
    expect(b.startExclusive.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(b.endInclusive.toISOString()).toBe('2026-10-02T00:00:00.000Z')
  })
})
