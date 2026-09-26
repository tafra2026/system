import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Paymob (KSA) transaction-callback verification and state mapping. Pure: no I/O.
 *
 * Paymob signs the "transaction processed" callback with HMAC-SHA512 over the values of these
 * fields, concatenated in this exact order (booleans as "true"/"false"), using the merchant's
 * HMAC secret. The signature arrives as the `hmac` query parameter.
 * NOTE: written from Paymob's published scheme; must be confirmed against a real sandbox
 * callback before going live (docs/INTEGRATIONS.ar.md).
 */
export const PAYMOB_HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const

function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function asText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

export function paymobTransactionHmac(obj: unknown, secret: string): string {
  const message = PAYMOB_HMAC_FIELDS.map((f) => asText(pick(obj, f))).join('')
  return createHmac('sha512', secret).update(message, 'utf8').digest('hex')
}

/** Constant-time comparison; false for anything malformed. */
export function verifyPaymobHmac(obj: unknown, received: string | null | undefined, secret: string): boolean {
  if (!received || !secret || !/^[0-9a-f]{128}$/i.test(received)) return false
  const expected = Buffer.from(paymobTransactionHmac(obj, secret), 'hex')
  const got = Buffer.from(received.toLowerCase(), 'hex')
  return expected.length === got.length && timingSafeEqual(expected, got)
}

export type ProviderOutcome = 'paid' | 'authorized' | 'failed' | 'pending' | 'voided' | 'refunded'

/**
 * Map a Paymob transaction to our outcome. An authorization that is not captured is NOT
 * collected money. Redirect results in the browser are never used for this.
 */
export function classifyPaymobTransaction(obj: Record<string, unknown>): ProviderOutcome {
  const t = (k: string) => obj[k] === true || obj[k] === 'true'
  if (t('is_refunded')) return 'refunded'
  if (t('is_voided')) return 'voided'
  if (t('pending')) return 'pending'
  if (!t('success')) return 'failed'
  if (t('is_auth') && !t('is_capture')) return 'authorized'
  return 'paid'
}

/** Only these fields are stored for audit (masked card data as sent; never secrets). */
export function paymobAuditSummary(obj: Record<string, unknown>) {
  return {
    id: asText(obj.id),
    amount_cents: asText(obj.amount_cents),
    currency: asText(obj.currency),
    success: asText(obj.success),
    pending: asText(obj.pending),
    is_auth: asText(obj.is_auth),
    is_capture: asText(obj.is_capture),
    is_voided: asText(obj.is_voided),
    is_refunded: asText(obj.is_refunded),
    order_id: asText(pick(obj, 'order.id')),
    merchant_order_id: asText(pick(obj, 'order.merchant_order_id')),
    source_type: asText(pick(obj, 'source_data.type')),
    source_sub_type: asText(pick(obj, 'source_data.sub_type')),
    created_at: asText(obj.created_at),
  }
}
