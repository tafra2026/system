import { type NextRequest } from 'next/server'
import { verifyTabbyWebhookSecret } from '@/server/integrations/tabby'
import { json } from '@/server/http'
import { syncTabbyPayment } from '@/server/services/payment-links'

/**
 * Tabby webhook (server-to-server). Accepted only with our secret header (registered with Tabby
 * as "X-Pamper-Webhook"). The body is only used for the payment id: the payment itself is read
 * back from Tabby's API before anything is recorded. Nothing sensitive is logged.
 */
export async function POST(req: NextRequest) {
  if (!verifyTabbyWebhookSecret(req.headers.get('x-pamper-webhook'))) return json({ ok: false }, 401)
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  if (!body || typeof body.id !== 'string') return json({ ok: false }, 400)
  try {
    return json({ ok: true, outcome: await syncTabbyPayment(body.id) })
  } catch (err) {
    console.error('Tabby webhook failed:', err instanceof Error ? err.name : 'unknown')
    return json({ ok: false }, 500)
  }
}
