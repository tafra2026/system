import 'server-only'

/**
 * The public address of the app (e.g. https://pamperme-ksa.com), used in links sent outside:
 * payment links and gateway return/notification URLs, invite links, customer documents.
 *
 * APP_BASE_URL wins when set. If it is missing, the address is learned from the first real
 * request this server handles (Host / X-Forwarded-Host behind the hosting proxy), so links never
 * point at "localhost" in production. Local development falls back to http://localhost:3000.
 */
let learned: string | null = null

function configured(): string | null {
  const v = process.env.APP_BASE_URL?.trim()
  return v ? v.replace(/\/$/, '') : null
}

export function appBaseUrl(): string {
  return configured() ?? learned ?? 'http://localhost:3000'
}

/** Remember this request's public origin (no-op when APP_BASE_URL is set or outside a request). */
export async function learnBaseUrlFromRequest(): Promise<void> {
  if (configured() || learned) return
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    const host = (h.get('x-forwarded-host') ?? h.get('host'))?.split(',')[0]?.trim()
    if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return
    const local = /^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(host)
    if (local && process.env.NODE_ENV === 'production') return
    const proto = (h.get('x-forwarded-proto')?.split(',')[0]?.trim() || (local ? 'http' : 'https')).toLowerCase()
    learned = `${proto === 'http' ? 'http' : 'https'}://${host.toLowerCase()}`
  } catch {
    // Not inside a request (worker, script): keep the fallback.
  }
}
