import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { providerErrorDetail, type JsonTransport } from './tabby'

/**
 * Tamara (split in payments) — hosted checkout. Our server never sees card data.
 *
 * Configuration (server environment only):
 *   TAMARA_API_TOKEN           merchant API token (Authorization: Bearer …)
 *   TAMARA_NOTIFICATION_TOKEN  notification key used by Tamara to sign its notifications (JWT, HS256)
 *   TAMARA_BASE_URL            optional, default https://api.tamara.co (test: https://api-sandbox.tamara.co)
 *
 * Flow: create checkout → customer approves on Tamara → Tamara notifies us (signed token) → we
 * READ the order from Tamara's API, check amount/currency/reference, authorise it, capture the full
 * amount, and only then record the payment.
 *
 * NOTE: shapes follow Tamara's published API and must be confirmed in the Tamara sandbox
 * before live use (docs/INTEGRATIONS.ar.md).
 */

export function tamaraBaseUrl(): string {
  return (process.env.TAMARA_BASE_URL?.trim() || 'https://api.tamara.co').replace(/\/$/, '')
}

export function tamaraConfigured(): boolean {
  return !!(process.env.TAMARA_API_TOKEN?.trim() && process.env.TAMARA_NOTIFICATION_TOKEN?.trim())
}

/** Verify the HS256 JWT Tamara attaches to notifications (tamaraToken / Bearer). */
export function verifyTamaraToken(token: string | null, now = Date.now()): boolean {
  const secret = process.env.TAMARA_NOTIFICATION_TOKEN?.trim()
  if (!secret || !token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [h, p, s] = parts as [string, string, string]
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string }
    if (header.alg !== 'HS256') return false
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest()
    const got = Buffer.from(s, 'base64url')
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return false
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as { exp?: number }
    if (typeof payload.exp === 'number' && payload.exp * 1000 < now) return false
    return true
  } catch {
    return false
  }
}

const realTransport: JsonTransport = (url, init) => fetch(url, init)
let transport: JsonTransport = realTransport

/** TESTS ONLY — development mock: never contacts Tamara. */
export function useMockTamaraTransportForTests(mock: JsonTransport | null) {
  transport = mock ?? realTransport
}

async function call(method: string, path: string, body?: unknown, timeoutMs = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await transport(`${tamaraBaseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.TAMARA_API_TOKEN?.trim() ?? ''}`, 'Content-Type': 'application/json' },
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

/** Tamara amounts are decimal numbers in SAR. Halalas are integers, so this is exact to 2 places. */
const money = (halalas: number) => ({ amount: Math.floor(halalas / 100) + (halalas % 100) / 100, currency: 'SAR' })
/** Back to integer halalas without float drift. */
export function tamaraAmountToHalalas(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export interface TamaraCheckoutInput {
  reference: string
  orderNumber: string
  amountHalalas: number
  customerName: string | null
  phoneE164: string
  description: string
  locale: 'ar' | 'en'
  address: { city: string; line: string } | null
  successUrl: string
  failureUrl: string
  cancelUrl: string
  notificationUrl: string
}

export type TamaraCheckoutResult =
  | { ok: true; providerRef: string; checkoutUrl: string }
  | { ok: false; code: 'timeout_unknown' | 'rejected' | 'network' | 'bad_response'; detail?: string }

export async function createTamaraCheckout(input: TamaraCheckoutInput): Promise<TamaraCheckoutResult> {
  const [first, ...rest] = (input.customerName?.trim() || 'Customer').split(/\s+/)
  const phone = input.phoneE164.replace(/^\+/, '')
  const zero = money(0)
  const body = {
    order_reference_id: input.reference,
    order_number: input.orderNumber,
    total_amount: money(input.amountHalalas),
    description: input.description.slice(0, 250),
    country_code: 'SA',
    payment_type: 'PAY_BY_INSTALMENTS',
    locale: input.locale === 'en' ? 'en_US' : 'ar_SA',
    items: [{ reference_id: input.reference, type: 'Digital', name: input.description.slice(0, 100), sku: input.reference, quantity: 1, total_amount: money(input.amountHalalas) }],
    consumer: { first_name: first || 'Customer', last_name: rest.join(' ') || '-', phone_number: phone },
    shipping_address: { first_name: first || 'Customer', last_name: rest.join(' ') || '-', line1: input.address?.line ?? 'Jeddah', city: input.address?.city ?? 'Jeddah', country_code: 'SA', phone_number: phone },
    tax_amount: zero,
    shipping_amount: zero,
    merchant_url: { success: input.successUrl, failure: input.failureUrl, cancel: input.cancelUrl, notification: input.notificationUrl },
  }
  const r = await call('POST', '/checkout', body)
  if (!r.ok) return { ok: false, code: r.timeout ? 'timeout_unknown' : 'network' }
  if (r.status < 200 || r.status >= 300 || !r.data) return { ok: false, code: 'rejected', detail: providerErrorDetail(r.data, r.status) }
  const d = r.data as { order_id?: string; checkout_url?: string }
  if (!d.order_id || !d.checkout_url) return { ok: false, code: 'bad_response' }
  return { ok: true, providerRef: d.order_id, checkoutUrl: d.checkout_url }
}

export interface TamaraOrder {
  id: string
  /** new, approved, authorised, partially_captured, fully_captured, declined, expired, canceled … */
  status: string
  amountHalalas: number | null
  currency: string | null
  reference: string | null
}

export async function getTamaraOrder(orderId: string): Promise<TamaraOrder | null> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(orderId)) return null
  const r = await call('GET', `/orders/${encodeURIComponent(orderId)}`)
  if (!r.ok || r.status !== 200 || !r.data) return null
  const d = r.data as { order_id?: string; status?: string; total_amount?: { amount?: unknown; currency?: string }; order_reference_id?: string }
  return {
    id: d.order_id ?? orderId,
    status: String(d.status ?? '').toLowerCase(),
    amountHalalas: tamaraAmountToHalalas(d.total_amount?.amount),
    currency: d.total_amount?.currency ?? null,
    reference: d.order_reference_id ?? null,
  }
}

export async function authoriseTamaraOrder(orderId: string): Promise<boolean> {
  const r = await call('POST', `/orders/${encodeURIComponent(orderId)}/authorise`)
  return r.ok && r.status >= 200 && r.status < 300
}

export async function captureTamaraOrder(orderId: string, amountHalalas: number): Promise<boolean> {
  const r = await call('POST', '/payments/capture', {
    order_id: orderId,
    total_amount: money(amountHalalas),
    shipping_info: { shipped_at: new Date().toISOString(), shipping_company: 'Home service' },
  })
  return r.ok && r.status >= 200 && r.status < 300
}
