import { type NextRequest } from 'next/server'
import { verifyTamaraToken } from '@/server/integrations/tamara'
import { json } from '@/server/http'
import { syncTamaraOrder } from '@/server/services/payment-links'

/**
 * Tamara notification (server-to-server). Accepted only with a valid signed token (tamaraToken
 * query parameter or Bearer header). The order is then read back from Tamara's API before
 * anything is recorded. Nothing sensitive is logged.
 */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  if (!verifyTamaraToken(req.nextUrl.searchParams.get('tamaraToken') ?? bearer)) return json({ ok: false }, 401)
  const body = (await req.json().catch(() => null)) as { order_id?: unknown } | null
  if (!body || typeof body.order_id !== 'string') return json({ ok: false }, 400)
  try {
    return json({ ok: true, outcome: await syncTamaraOrder(body.order_id) })
  } catch (err) {
    console.error('Tamara notification failed:', err instanceof Error ? err.name : 'unknown')
    return json({ ok: false }, 500)
  }
}
