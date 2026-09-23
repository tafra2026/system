import { describe, expect, it } from 'vitest'
import { parseSarInput, percentOf, sar, splitEvenly, toSarString } from '@/domain/money'

describe('money', () => {
  it('converts SAR to integer halalas', () => {
    expect(sar(249.99)).toBe(24999)
    expect(sar(1000.01)).toBe(100001)
    expect(() => sar(1.001)).toThrow()
  })

  it('parses user input including Arabic-Indic digits', () => {
    expect(parseSarInput('196')).toBe(19600)
    expect(parseSarInput('196.5')).toBe(19650)
    expect(parseSarInput('١٩٦٫٥')).toBe(19650)
    expect(parseSarInput('1,000')).toBe(100000)
    expect(parseSarInput('-5')).toBeNull()
    expect(parseSarInput('1.234')).toBeNull()
    expect(parseSarInput('')).toBeNull()
  })

  it('rounds percentages half-up to the halala', () => {
    expect(percentOf(19600, 2500)).toBe(4900)
    expect(percentOf(14602, 2500)).toBe(3651) // 3650.5 -> 3651
    expect(percentOf(14601, 2500)).toBe(3650) // 3650.25 -> 3650
  })

  it('splits evenly with the remainder on the first shares', () => {
    expect(splitEvenly(49600, 2)).toEqual([24800, 24800])
    expect(splitEvenly(39601, 2)).toEqual([19801, 19800])
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333])
  })

  it('formats plain decimal strings', () => {
    expect(toSarString(14700)).toBe('147.00')
    expect(toSarString(5)).toBe('0.05')
  })
})
