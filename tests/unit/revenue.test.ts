import { describe, expect, it } from 'vitest'
import { allocateOrderRevenue, growth } from '@/domain/revenue'

describe('revenue allocation (spec §15)', () => {
  it('two equal sessions split the package value equally; remainder on the first', () => {
    expect(Object.fromEntries(allocateOrderRevenue([{ final: 49600, visitIds: ['v1', 'v2'] }], 0, 'v1'))).toEqual({ v1: 24800, v2: 24800 })
    expect(Object.fromEntries(allocateOrderRevenue([{ final: 37201, visitIds: ['v1', 'v2'] }], 0, 'v1'))).toEqual({ v1: 18601, v2: 18600 })
  })
  it('services go to their visit; delivery to the first visit; totals reconcile', () => {
    const m = allocateOrderRevenue(
      [
        { final: 19600, visitIds: ['v1'] },
        { final: 49600, visitIds: ['v1', 'v2'] },
      ],
      2000,
      'v1',
    )
    expect(Object.fromEntries(m)).toEqual({ v1: 19600 + 24800 + 2000, v2: 24800 })
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(19600 + 49600 + 2000)
  })
  it('growth is null when the previous period is zero', () => {
    expect(growth(100, 0)).toBeNull()
    expect(growth(150, 100)).toBe(50)
    expect(growth(0, 100)).toBe(-100)
  })
})
