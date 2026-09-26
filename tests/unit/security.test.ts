import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { clearFailures, isThrottled, recordFailure } from '@/server/auth/throttle'
import { ForbiddenError } from '@/server/authz/errors'
import { assertSameOrigin } from '@/server/http'

const req = (headers: Record<string, string>, url = 'http://localhost:3000/api/x') => new NextRequest(url, { method: 'POST', headers })

describe('same-origin check behind a hosting proxy', () => {
  it('accepts the public origin even when the server sees itself as localhost', () => {
    expect(() => assertSameOrigin(req({ origin: 'https://test.tafraa.com', 'x-forwarded-host': 'test.tafraa.com', host: 'localhost:3000' }))).not.toThrow()
    expect(() => assertSameOrigin(req({ origin: 'http://localhost:3000' }))).not.toThrow()
  })
  it('rejects other sites, malformed origins and cross-site requests without Origin', () => {
    expect(() => assertSameOrigin(req({ origin: 'https://evil.example', host: 'test.tafraa.com' }))).toThrow(ForbiddenError)
    expect(() => assertSameOrigin(req({ origin: 'null', host: 'test.tafraa.com' }))).toThrow(ForbiddenError)
    expect(() => assertSameOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toThrow(ForbiddenError)
    expect(() => assertSameOrigin(req({ 'sec-fetch-site': 'same-origin' }))).not.toThrow()
  })
})

describe('sign-in throttle per client address', () => {
  it('blocks after 20 failures within 15 minutes and recovers afterwards', () => {
    const key = `test-${Math.random()}`
    const t0 = 1_000_000
    for (let i = 0; i < 19; i++) recordFailure(key, t0 + i)
    expect(isThrottled(key, t0 + 100)).toBe(false)
    recordFailure(key, t0 + 200)
    expect(isThrottled(key, t0 + 300)).toBe(true)
    expect(isThrottled(key, t0 + 16 * 60_000)).toBe(false)
    recordFailure(key, t0)
    clearFailures(key)
    expect(isThrottled(key, t0)).toBe(false)
  })
})
