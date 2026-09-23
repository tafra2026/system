import { describe, expect, it, vi } from 'vitest'
import { isShortMapsLink, resolveShortMapsLink } from '@/server/integrations/maps-links'

// DEVELOPMENT MOCK of fetch — no real request is made.
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

describe('Google Maps short links', () => {
  it('recognises only https short-link hosts', () => {
    expect(isShortMapsLink('https://maps.app.goo.gl/G3NWLVsyKBotkfiC8?g_st=iwb')).toBe(true)
    expect(isShortMapsLink('http://maps.app.goo.gl/x')).toBe(false)
    expect(isShortMapsLink('https://evil.example/x')).toBe(false)
  })

  it('follows redirects to the full Maps URL and reads the coordinates', async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect('https://www.google.com/maps/place/X/@21.4858,39.1925,17z/data=!3d21.4859!4d39.1926'))
    expect(await resolveShortMapsLink('https://maps.app.goo.gl/abc', f as unknown as typeof fetch)).toEqual({ ok: true, latitude: 21.4859, longitude: 39.1926 })
  })

  it('handles a consent-page hop', async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect('https://consent.google.com/m?continue=' + encodeURIComponent('https://maps.google.com/?q=21.5,39.2')))
    expect(await resolveShortMapsLink('https://maps.app.goo.gl/abc', f as unknown as typeof fetch)).toEqual({ ok: true, latitude: 21.5, longitude: 39.2 })
  })

  it('never follows redirects to non-Google hosts; network errors are reported', async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect('https://attacker.example/@21.5,39.2'))
    expect(await resolveShortMapsLink('https://maps.app.goo.gl/abc', f as unknown as typeof fetch)).toEqual({ ok: false, reason: 'unresolved' })
    const g = vi.fn().mockRejectedValue(new Error('blocked'))
    expect(await resolveShortMapsLink('https://maps.app.goo.gl/abc', g as unknown as typeof fetch)).toEqual({ ok: false, reason: 'unresolved' })
  })
})
