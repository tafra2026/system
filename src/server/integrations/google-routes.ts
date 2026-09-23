import 'server-only'

/**
 * Google Maps Routes API (v2) — travel time by car, traffic-aware for future departures.
 * Endpoint: POST https://routes.googleapis.com/directions/v2:computeRoutes
 * Auth: X-Goog-Api-Key header; a response field mask is mandatory (X-Goog-FieldMask).
 *
 * The key is read ONLY from the server environment (GOOGLE_MAPS_API_KEY) and never logged.
 * NOTE: written against the official Routes API reference; it must be verified with a real
 * key once the environment allows routes.googleapis.com (see docs/INTEGRATIONS.ar.md).
 */
export interface LatLng {
  latitude: number
  longitude: number
}

export type TravelResult =
  | { ok: true; minutes: number; distanceMeters: number | null; trafficAware: boolean }
  | { ok: false; reason: 'not_configured' | 'failed' | 'no_route' }

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'

export function mapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY)
}

export async function computeTravelMinutes(origin: LatLng, destination: LatLng, departureTime: Date, fetchImpl: typeof fetch = fetch): Promise<TravelResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return { ok: false, reason: 'not_configured' }
  // Traffic-aware routing needs a departure time that is not in the past.
  const trafficAware = departureTime.getTime() > Date.now() + 60_000
  const body = {
    origin: { location: { latLng: origin } },
    destination: { location: { latLng: destination } },
    travelMode: 'DRIVE',
    routingPreference: trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
    ...(trafficAware ? { departureTime: departureTime.toISOString() } : {}),
    languageCode: 'ar',
    units: 'METRIC',
  }
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error('Google Routes error status', res.status)
      return { ok: false, reason: 'failed' }
    }
    const json = (await res.json()) as { routes?: { duration?: string; distanceMeters?: number }[] }
    const route = json.routes?.[0]
    const seconds = route?.duration ? Number.parseFloat(route.duration.replace(/s$/, '')) : NaN
    if (!route || !Number.isFinite(seconds)) return { ok: false, reason: 'no_route' }
    return { ok: true, minutes: Math.max(1, Math.ceil(seconds / 60)), distanceMeters: route.distanceMeters ?? null, trafficAware }
  } catch {
    console.error('Google Routes request failed')
    return { ok: false, reason: 'failed' }
  }
}
