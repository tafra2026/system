import 'server-only'
import { parseCoordinates } from '@/domain/order'

/**
 * Google Maps short links (maps.app.goo.gl/…, shared from phones and WhatsApp) do not contain
 * coordinates. The server follows their redirects — only between Google hosts, at most 5 hops,
 * no cookies or keys — and reads the coordinates from the final Maps URL.
 */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl'])
const FOLLOW_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/

export function isShortMapsLink(text: string): boolean {
  try {
    const u = new URL(text.trim())
    return u.protocol === 'https:' && SHORT_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

export type ResolveResult = { ok: true; latitude: number; longitude: number } | { ok: false; reason: 'not_short_link' | 'unresolved' }

export async function resolveShortMapsLink(text: string, fetchImpl: typeof fetch = fetch): Promise<ResolveResult> {
  if (!isShortMapsLink(text)) return { ok: false, reason: 'not_short_link' }
  let url = text.trim()
  try {
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000) })
      const location = res.headers.get('location')
      if (!location) break
      const next = new URL(location, url)
      if (next.protocol !== 'https:' || !FOLLOW_HOSTS.test(next.hostname)) break
      // Consent pages carry the real destination in ?continue=
      const target = next.hostname.startsWith('consent.') ? (next.searchParams.get('continue') ?? next.href) : next.href
      const coords = parseCoordinates(target)
      if (coords) return { ok: true, ...coords }
      url = target
    }
  } catch {
    // network error or timeout
  }
  return { ok: false, reason: 'unresolved' }
}

/** Coordinates from pasted text: plain coordinates, a full Maps link, or a short link. */
export async function coordinatesFromInput(text: string): Promise<{ latitude: number; longitude: number } | null> {
  const direct = parseCoordinates(text)
  if (direct) return direct
  const r = await resolveShortMapsLink(text)
  return r.ok ? { latitude: r.latitude, longitude: r.longitude } : null
}
