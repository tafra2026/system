import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDayOff, legTimes, validateBuffer } from '@/domain/trips'
import { computeTravelMinutes } from '@/server/integrations/google-routes'
import { riyadhLocalToInstant } from '@/domain/operational-day'

describe('leg timing', () => {
  const start = riyadhLocalToInstant('2026-10-01', '20:00')
  it('dropoff arrives at the visit start; departure = travel + buffer earlier', () => {
    const t = legTimes({ kind: 'dropoff', visitStart: start, visitDurationMinutes: 60, travelMinutes: 25, bufferMinutes: 15 })
    expect(t.arriveAt).toEqual(start)
    expect((start.getTime() - t.departAt.getTime()) / 60_000).toBe(40)
  })
  it('pickup arrives at the visit end', () => {
    const t = legTimes({ kind: 'pickup', visitStart: start, visitDurationMinutes: 90, travelMinutes: 10, bufferMinutes: 10 })
    expect((t.arriveAt.getTime() - start.getTime()) / 60_000).toBe(90)
  })
  it('buffer must be 10–15', () => {
    expect(() => validateBuffer(9)).toThrow('buffer_out_of_range')
    expect(() => validateBuffer(16)).toThrow()
    expect(validateBuffer(10)).toBe(10)
  })
  it('days off: weekly and specific dates', () => {
    expect(isDayOff('2026-10-02', { weekly: [5], dates: [] })).toBe(true) // Friday
    expect(isDayOff('2026-10-01', { weekly: [5], dates: ['2026-10-01'] })).toBe(true)
    expect(isDayOff('2026-10-03', { weekly: [5], dates: [] })).toBe(false)
  })
})

describe('Google Routes adapter (DEVELOPMENT MOCK of fetch — no real request is made)', () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY
  })
  const o = { latitude: 21.5, longitude: 39.2 }
  it('reports not configured without a key', async () => {
    expect(await computeTravelMinutes(o, o, new Date())).toEqual({ ok: false, reason: 'not_configured' })
  })
  it('sends the key and field mask as headers and parses the duration', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key-not-real'
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ routes: [{ duration: '1261s', distanceMeters: 9000 }] }), { status: 200 }))
    const r = await computeTravelMinutes(o, o, new Date(Date.now() + 3600_000), mockFetch as unknown as typeof fetch)
    expect(r).toEqual({ ok: true, minutes: 22, distanceMeters: 9000, trafficAware: true })
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Goog-Api-Key']).toBe('test-key-not-real')
    expect(headers['X-Goog-FieldMask']).toBe('routes.duration,routes.distanceMeters')
    expect(JSON.parse(init.body as string)).toMatchObject({ travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' })
  })
  it('failures are reported, never thrown', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key-not-real'
    const failing = vi.fn(async () => new Response('denied', { status: 403 }))
    expect(await computeTravelMinutes(o, o, new Date(), failing as unknown as typeof fetch)).toEqual({ ok: false, reason: 'failed' })
    const throwing = vi.fn(async () => {
      throw new Error('network')
    })
    expect(await computeTravelMinutes(o, o, new Date(), throwing as unknown as typeof fetch)).toEqual({ ok: false, reason: 'failed' })
  })
})
