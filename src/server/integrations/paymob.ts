import 'server-only'

/**
 * Paymob KSA "Intention" checkout (unified checkout page). Our server never sees card data:
 * we create an intention and send the customer to Paymob's hosted checkout, which shows only
 * the methods enabled on the merchant account (card/mada, Apple Pay, STC Pay …).
 *
 * Configuration (server environment only):
 *   PAYMOB_SECRET_KEY    secret API key (Authorization: Token …)
 *   PAYMOB_PUBLIC_KEY    public key used in the checkout URL
 *   PAYMOB_HMAC_SECRET   HMAC secret for transaction callbacks
 *   PAYMOB_INTEGRATIONS  enabled integrations, e.g. "card:12345,apple_pay:23456,stc_pay:34567"
 *   PAYMOB_BASE_URL      optional, default https://ksa.paymob.com
 *
 * NOTE: request/response shapes follow Paymob's published Intention API; they must be
 * confirmed in the Paymob sandbox before live use (docs/INTEGRATIONS.ar.md).
 */
export const PAYMOB_METHODS = ['card', 'apple_pay', 'stc_pay'] as const
export type PaymobMethod = (typeof PAYMOB_METHODS)[number]

export function paymobBaseUrl(): string {
  return (process.env.PAYMOB_BASE_URL?.trim() || 'https://ksa.paymob.com').replace(/\/$/, '')
}

/** Methods that have an integration id configured — only these are offered. */
export function paymobIntegrations(): Map<PaymobMethod, number> {
  const out = new Map<PaymobMethod, number>()
  for (const part of (process.env.PAYMOB_INTEGRATIONS ?? '').split(',')) {
    const [name, id] = part.split(':').map((x) => x?.trim())
    if (name && id && (PAYMOB_METHODS as readonly string[]).includes(name) && /^\d+$/.test(id)) out.set(name as PaymobMethod, Number(id))
  }
  return out
}

export function paymobConfigured(): boolean {
  return !!(process.env.PAYMOB_SECRET_KEY?.trim() && process.env.PAYMOB_PUBLIC_KEY?.trim() && process.env.PAYMOB_HMAC_SECRET?.trim() && paymobIntegrations().size > 0)
}

export function paymobHmacSecret(): string {
  return process.env.PAYMOB_HMAC_SECRET?.trim() ?? ''
}

export interface IntentionInput {
  reference: string
  amountHalalas: number
  methods: PaymobMethod[]
  customerName: string | null
  phoneE164: string
  description: string
  notificationUrl: string
  redirectionUrl: string
}

export type IntentionResult =
  | { ok: true; providerRef: string; checkoutUrl: string }
  /** `unknown`: the request may have reached Paymob (timeout) — check before creating again. */
  | { ok: false; code: 'timeout_unknown' | 'rejected' | 'network' | 'bad_response' }

export type HttpTransport = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>

const realTransport: HttpTransport = (url, init) => fetch(url, init)
let transport: HttpTransport = realTransport

/** TESTS ONLY — development mock: never contacts Paymob. */
export function useMockPaymobTransportForTests(mock: HttpTransport | null) {
  transport = mock ?? realTransport
}

export async function createIntention(input: IntentionInput, timeoutMs = 15_000): Promise<IntentionResult> {
  const integrations = paymobIntegrations()
  const ids = input.methods.map((m) => integrations.get(m)).filter((x): x is number => typeof x === 'number')
  const [first, ...rest] = (input.customerName ?? 'Customer').trim().split(/\s+/)
  const body = {
    amount: input.amountHalalas,
    currency: 'SAR',
    payment_methods: ids,
    items: [{ name: input.description.slice(0, 50), amount: input.amountHalalas, description: input.description.slice(0, 250), quantity: 1 }],
    billing_data: {
      first_name: first || 'Customer',
      last_name: rest.join(' ') || 'NA',
      phone_number: input.phoneE164,
      email: 'NA',
      country: 'SA',
    },
    special_reference: input.reference,
    notification_url: input.notificationUrl,
    redirection_url: input.redirectionUrl,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await transport(`${paymobBaseUrl()}/v1/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${process.env.PAYMOB_SECRET_KEY?.trim() ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (res.status < 200 || res.status >= 300) return { ok: false, code: 'rejected' }
    const data = (await res.json()) as { id?: unknown; client_secret?: unknown; intention_order_id?: unknown }
    if (typeof data.client_secret !== 'string' || data.id == null) return { ok: false, code: 'bad_response' }
    const checkoutUrl = `${paymobBaseUrl()}/unifiedcheckout/?publicKey=${encodeURIComponent(process.env.PAYMOB_PUBLIC_KEY?.trim() ?? '')}&clientSecret=${encodeURIComponent(data.client_secret)}`
    return { ok: true, providerRef: String(data.intention_order_id ?? data.id), checkoutUrl }
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, code: 'timeout_unknown' }
    return { ok: false, code: 'network' }
  } finally {
    clearTimeout(timer)
  }
}
