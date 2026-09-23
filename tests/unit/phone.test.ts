import { describe, expect, it } from 'vitest'
import { normalizePhone, waNumber } from '@/domain/phone'

describe('phone normalization', () => {
  it('normalizes Saudi formats to E.164', () => {
    for (const input of ['0501234567', '501234567', '966501234567', '00966501234567', '+966 50 123 4567', '٠٥٠١٢٣٤٥٦٧', '+9660501234567']) {
      expect(normalizePhone(input)).toBe('+966501234567')
    }
  })
  it('keeps valid international numbers and rejects junk', () => {
    expect(normalizePhone('+63 917 123 4567')).toBe('+639171234567')
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('+96650')).toBeNull()
  })
  it('wa.me needs digits only', () => {
    expect(waNumber('+966501234567')).toBe('966501234567')
  })
})
