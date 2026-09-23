import { describe, expect, it } from 'vitest'
import { DEFAULT_MESSAGE_TEMPLATES, MESSAGE_KINDS, reminderDueAt, renderMessage, unknownPlaceholders, whatsappChatLink } from '@/domain/messages'

const at = (iso: string) => new Date(iso)

describe('reminder timing (spec §13)', () => {
  it('is due three hours before the visit', () => {
    expect(reminderDueAt(at('2026-10-01T20:00:00+03:00'), at('2026-09-30T10:00:00+03:00'))).toEqual(at('2026-10-01T17:00:00+03:00'))
  })
  it('a booking less than three hours ahead gets one immediate reminder', () => {
    const now = at('2026-10-01T18:30:00+03:00')
    expect(reminderDueAt(at('2026-10-01T20:00:00+03:00'), now)).toEqual(now)
  })
  it('no reminder once the visit has started', () => {
    expect(reminderDueAt(at('2026-10-01T20:00:00+03:00'), at('2026-10-01T20:00:00+03:00'))).toBeNull()
  })
})

describe('rendering', () => {
  it('fills placeholders and drops lines whose value is missing', () => {
    const text = renderMessage('Hi {customer_name}\nLink: {review_link}\nRef {order_ref}', { customer_name: 'Sara', order_ref: 'PM-1' })
    expect(text).toBe('Hi Sara\nRef PM-1')
  })
  it('leaves unknown {words} as typed and reports them', () => {
    expect(renderMessage('Hello {nickname}', {})).toBe('Hello {nickname}')
    expect(unknownPlaceholders('Hi {customer_name} {nickname}')).toEqual(['nickname'])
  })
  it('default templates are complete, use only known words, and English has no Arabic', () => {
    for (const k of MESSAGE_KINDS) {
      expect(unknownPlaceholders(DEFAULT_MESSAGE_TEMPLATES[k].ar)).toEqual([])
      expect(unknownPlaceholders(DEFAULT_MESSAGE_TEMPLATES[k].en)).toEqual([])
      expect(DEFAULT_MESSAGE_TEMPLATES[k].en).not.toMatch(/[؀-ۿ]/)
      expect(DEFAULT_MESSAGE_TEMPLATES[k].ar).toContain('Pamper Me')
    }
  })
})

describe('WhatsApp link', () => {
  it('uses digits only and URL-encodes Arabic text, spaces, newlines and symbols', () => {
    const link = whatsappChatLink('+966501234567', 'هلا سارة\nالمتبقي: 50 ر.س & شكرًا #1')
    expect(link.startsWith('https://wa.me/966501234567?text=')).toBe(true)
    const text = new URL(link).searchParams.get('text')
    expect(text).toBe('هلا سارة\nالمتبقي: 50 ر.س & شكرًا #1')
    expect(link).not.toContain(' ')
    expect(link).toContain('%0A')
  })
})
