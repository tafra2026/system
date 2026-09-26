import { type NextRequest } from 'next/server'
import { json } from '@/server/http'
import { handlePaymobCallback } from '@/server/services/payment-links'

/**
 * Paymob "transaction processed" callback (server-to-server). Public by design: it is
 * authenticated by the HMAC signature, not by a session. Nothing sensitive is logged.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  try {
    const r = await handlePaymobCallback(req.nextUrl.searchParams.get('hmac'), body)
    return json({ ok: r.status === 200, outcome: r.outcome }, r.status)
  } catch (err) {
    console.error('Paymob callback failed:', err instanceof Error ? err.name : 'unknown')
    // 500 lets Paymob retry; the event key makes the retry safe.
    return json({ ok: false }, 500)
  }
}
