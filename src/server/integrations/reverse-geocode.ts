import 'server-only'

/**
 * District (neighbourhood) name for a map point, used only to pre-fill the "district" field —
 * staff always see and can correct it. Google Geocoding when GOOGLE_MAPS_API_KEY is set,
 * otherwise OpenStreetMap Nominatim (free; light use only, identified by our User-Agent).
 * Returns null on any failure: picking a location never depends on this.
 */
export async function districtForPoint(lat: number, lng: number, locale: 'ar' | 'en'): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const key = process.env.GOOGLE_MAPS_API_KEY?.trim()
    if (key) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=${locale}&result_type=sublocality|neighborhood&key=${encodeURIComponent(key)}`
      const res = await fetch(url, { signal: controller.signal })
      const data = (await res.json()) as { results?: { address_components?: { long_name: string; types: string[] }[] }[] }
      const comps = data.results?.[0]?.address_components ?? []
      const hit = comps.find((c) => c.types.includes('sublocality') || c.types.includes('neighborhood') || c.types.includes('sublocality_level_1'))
      return hit?.long_name?.slice(0, 120) ?? null
    }
    const base = (process.env.APP_BASE_URL ?? 'https://localhost').replace(/\/$/, '')
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&accept-language=${locale}`, {
      signal: controller.signal,
      headers: { 'User-Agent': `PamperMe-internal/1.0 (${base})` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { address?: Record<string, string> }
    const a = data.address ?? {}
    const name = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? a.residential ?? null
    return name ? name.replace(/^حي\s+/, '').slice(0, 120) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
