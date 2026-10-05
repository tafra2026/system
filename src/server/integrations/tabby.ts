import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { parseSarInput, toSarString } from '@/domain/money'

/**
 * Tabby (pay in 4) — hosted checkout. Our server never sees card data.
 *
 * Configuration (server environment only):
 *   TABBY_SECRET_KEY     secret API key (Authorization: Bearer …)
 *   TABBY_MERCHANT_CODE  merchant code for Saudi Arabia (given by Tabby)
 *   TABBY_WEBHOOK_SECRET a long random value we choose; registered with Tabby as the webhook
 *                        header so we can tell Tabby's calls apart from anyone else's
 *   TABBY_BASE_URL       optional, default https://api.tabby.ai
 *
 * Flow: create a checkout session → customer pays on Tabby → Tabby notifies us → we READ the
 * payment from Tabby's API (never trusting the notification body), check amount/currency/reference,
 * capture the full amount, and only then record the payment.
 *
 * NOTE: shapes follow Tabby's published API v2 and must be confirmed in the Tabby test
 * environment before live use (docs/INTEGRATIONS.ar.md).
 */

export function tabbyBaseUrl(): string {
  return (process.env.TABBY_BASE_URL?.trim() || 'https://api.tabby.ai').replace(/\/$/, '')
}

/** Links work with the secret key + merchant code. The webhook secret is optional: without it
 *  Tabby's webhook is refused, and payments are confirmed by the return page and the worker re-check. */
export function tabbyConfigured(): boolean {
  return !!(process.env.TABBY_SECRET_KEY?.trim() && process.env.TABBY_MERCHANT_CODE?.trim())
}

/** Short reason from a provider error body, for staff (no keys, no phone numbers). */
export function providerErrorDetail(data: unknown, status: number): string {
  const d = (data ?? {}) as Record<string, unknown>
  const parts: string[] = []
  for (const k of ['error', 'message', 'errorType', 'error_code']) if (typeof d[k] === 'string') parts.push(d[k] as string)
  for (const k of ['errors', 'details']) {
    const v = d[k]
    if (Array.isArray(v)) for (const e of v.slice(0, 3)) parts.push(typeof e === 'string' ? e : JSON.stringify(e))
    else if (v && typeof v === 'object') parts.push(JSON.stringify(v))
  }
  const text = [`HTTP ${status}`, ...parts].join(' — ')
  return text.replace(/\+?\d{7,}/g, '…').replace(/(sk|pk)_[A-Za-z0-9_]+/g, '…').slice(0, 200)
}

/** Header value check for Tabby's webhook (constant-time). */
export function verifyTabbyWebhookSecret(received: string | null): boolean {
  const expected = process.env.TABBY_WEBHOOK_SECRET?.trim() ?? ''
  if (!expected || !received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type JsonTransport = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>
const realTransport: JsonTransport = (url, init) => fetch(url, init)
let transport: JsonTransport = realTransport

/** TESTS ONLY — development mock: never contacts Tabby. */
export function useMockTabbyTransportForTests(mock: JsonTransport | null) {
  transport = mock ?? realTransport
}

async function call(method: string, path: string, body?: unknown, timeoutMs = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await transport(`${tabbyBaseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.TABBY_SECRET_KEY?.trim() ?? ''}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    return { ok: true as const, status: res.status, data: data as Record<string, unknown> | null }
  } catch {
    return { ok: false as const, timeout: controller.signal.aborted }
  } finally {
    clearTimeout(timer)
  }
}

export interface CheckoutInput {
  reference: string
  amountHalalas: number
  customerName: string | null
  phoneE164: string
  description: string
  locale: 'ar' | 'en'
  address: { city: string; line: string } | null
  successUrl: string
  cancelUrl: string
  failureUrl: string
}

export type CheckoutResult =
  | { ok: true; providerRef: string; checkoutUrl: string }
  | { ok: false; code: 'timeout_unknown' | 'rejected' | 'network' | 'bad_response' | 'not_eligible'; detail?: string }

/** Tabby wants the local Saudi number (5XXXXXXXX) for Saudi customers. */
function tabbyPhone(e164: string) {
  return e164.startsWith('+966') ? e164.slice(4) : e164.replace(/^\+/, '')
}

export async function createTabbyCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const amount = toSarString(input.amountHalalas)
  const body = {
    payment: {
      amount,
      currency: 'SAR',
      description: input.description.slice(0, 250),
      buyer: { phone: tabbyPhone(input.phoneE164), name: input.customerName?.trim() || 'Customer' },
      shipping_address: { city: input.address?.city ?? 'Jeddah', address: input.address?.line ?? 'Jeddah', zip: '00000' },
      order: {
        reference_id: input.reference,
        items: [{ title: input.description.slice(0, 100), quantity: 1, unit_price: amount, reference_id: input.reference, category: 'Beauty services' }],
      },
      buyer_history: { registered_since: new Date().toISOString(), loyalty_level: 0 },
      order_history: [],
    },
    lang: input.locale,
    merchant_code: process.env.TABBY_MERCHANT_CODE?.trim() ?? '',
    merchant_urls: { success: input.successUrl, cancel: input.cancelUrl, failure: input.failureUrl },
  }
  const r = await call('POST', '/api/v2/checkout', body)
  if (!r.ok) return { ok: false, code: r.timeout ? 'timeout_unknown' : 'network' }
  if (r.status < 200 || r.status >= 300 || !r.data) return { ok: false, code: 'rejected', detail: providerErrorDetail(r.data, r.status) }
  const d = r.data as { status?: string; payment?: { id?: string }; configuration?: { available_products?: { installments?: { web_url?: string }[] }; products?: { installments?: { rejection_reason?: string } } } }
  if (d.status === 'rejected') return { ok: false, code: 'not_eligible', detail: d.configuration?.products?.installments?.rejection_reason ?? undefined }
  const url = d.configuration?.available_products?.installments?.[0]?.web_url
  if (!d.payment?.id || !url) return { ok: false, code: 'bad_response' }
  return { ok: true, providerRef: d.payment.id, checkoutUrl: url }
}

export interface TabbyPayment {
  id: string
  /** Upper case as returned by the payments API: CREATED, AUTHORIZED, CLOSED, REJECTED, EXPIRED. */
  status: string
  amountHalalas: number | null
  currency: string | null
  reference: string | null
  capturedHalalas: number
  refundedHalalas: number
}

/** The payment as Tabby's API reports it (source of truth, not the notification body). */
export async function getTabbyPayment(id: string): Promise<TabbyPayment | null> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return null
  const r = await call('GET', `/api/v2/payments/${encodeURIComponent(id)}`)
  if (!r.ok || r.status !== 200 || !r.data) return null
  const d = r.data as { id?: string; status?: string; amount?: string; currency?: string; order?: { reference_id?: string }; captures?: { amount?: string }[]; refunds?: { amount?: string }[] }
  const sumOf = (xs?: { amount?: string }[]) => (xs ?? []).reduce((a, x) => a + (parseSarInput(x.amount ?? '') ?? 0), 0)
  return {
    id: d.id ?? id,
    status: String(d.status ?? '').toUpperCase(),
    amountHalalas: parseSarInput(d.amount ?? ''),
    currency: d.currency ?? null,
    reference: d.order?.reference_id ?? null,
    capturedHalalas: sumOf(d.captures),
    refundedHalalas: sumOf(d.refunds),
  }
}

/** Capture the full amount (services are delivered at home; the payment is collected now). */
export async function captureTabbyPayment(id: string, amountHalalas: number, referenceId: string): Promise<boolean> {
  const r = await call('POST', `/api/v2/payments/${encodeURIComponent(id)}/captures`, { amount: toSarString(amountHalalas), reference_id: referenceId })
  return r.ok && r.status >= 200 && r.status < 300
}
