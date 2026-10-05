import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '@/server/db'
import { paymentLinks, payments } from '@/server/db/schema'
import { useMockTabbyTransportForTests, type JsonTransport } from '@/server/integrations/tabby'
import { useMockTamaraTransportForTests, verifyTamaraToken } from '@/server/integrations/tamara'
import { cancelOrder, getOrderDetail, saveOrder } from '@/server/services/orders'
import { createPaymentLink, paymentLinkTarget, paymentLinkWhatsapp, syncTabbyPayment, syncTamaraOrder } from '@/server/services/payment-links'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

/**
 * DEVELOPMENT MOCKS — nothing here contacts Tabby or Tamara. The mocks answer like the
 * providers' published APIs so the whole flow (checkout → verify → capture → record) is exercised.
 */
const ENV = {
  TABBY_SECRET_KEY: 'sk_test_dummy',
  TABBY_MERCHANT_CODE: 'PAMPER_SA',
  TABBY_WEBHOOK_SECRET: 'whsec_test_dummy',
  TAMARA_API_TOKEN: 'tamara_test_dummy',
  TAMARA_NOTIFICATION_TOKEN: 'tamara_notify_test_dummy',
  APP_BASE_URL: 'https://test.example',
}
const saved: Record<string, string | undefined> = {}
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
})
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]
  else process.env[k] = v
  await closeDb()
})
beforeEach(resetDb)
afterEach(() => {
  useMockTabbyTransportForTests(null)
  useMockTamaraTransportForTests(null)
})

async function setup() {
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist')
  const cat = await catalog()
  const { customer, address } = await customerWithAddress(mod.actor)
  const swedish = await cat.svc('massage_swedish')
  const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] }, { confirm: true })
  const total = (await getOrderDetail(mod.actor, res.id)).order.grandTotalHalalas
  return { mod, customer, orderId: res.id, total }
}

type Req = { method: string; url: string; body: Record<string, unknown> | null }

/** Tabby mock with a payment that the customer has authorized. */
function mockTabby(opts: { rejectCheckout?: boolean; amountOverride?: string } = {}) {
  const reqs: Req[] = []
  let captured: string | null = null
  let reference = ''
  let amount = ''
  const t: JsonTransport = async (url, init) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null
    reqs.push({ method: init.method, url, body })
    if (url.endsWith('/api/v2/checkout')) {
      const p = body!.payment as { amount: string; order: { reference_id: string } }
      reference = p.order.reference_id
      amount = opts.amountOverride ?? p.amount
      if (opts.rejectCheckout) return { status: 200, json: async () => ({ status: 'rejected', configuration: { products: { installments: { rejection_reason: 'not_available' } } } }) }
      return { status: 200, json: async () => ({ id: 'sess_1', status: 'created', payment: { id: 'pay-tabby-0001' }, configuration: { available_products: { installments: [{ web_url: 'https://checkout.tabby.ai/?sessionId=sess_1' }] } } }) }
    }
    if (url.endsWith('/captures')) {
      captured = (body as { amount: string }).amount
      return { status: 200, json: async () => ({}) }
    }
    // GET payment
    return { status: 200, json: async () => ({ id: 'pay-tabby-0001', status: captured ? 'CLOSED' : 'AUTHORIZED', amount, currency: 'SAR', order: { reference_id: reference }, captures: captured ? [{ amount: captured }] : [], refunds: [] }) }
  }
  useMockTabbyTransportForTests(t)
  return reqs
}

function mockTamara() {
  const reqs: Req[] = []
  let status = 'approved'
  let reference = ''
  let amount = 0
  const t: JsonTransport = async (url, init) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null
    reqs.push({ method: init.method, url, body })
    if (url.endsWith('/checkout')) {
      reference = body!.order_reference_id as string
      amount = (body!.total_amount as { amount: number }).amount
      return { status: 200, json: async () => ({ order_id: 'tam-order-0001', checkout_id: 'c1', checkout_url: 'https://checkout.tamara.co/c1', status: 'new' }) }
    }
    if (url.endsWith('/authorise')) {
      status = 'authorised'
      return { status: 200, json: async () => ({ status: 'authorised' }) }
    }
    if (url.endsWith('/payments/capture')) {
      status = 'fully_captured'
      return { status: 200, json: async () => ({ status: 'fully_captured' }) }
    }
    return { status: 200, json: async () => ({ order_id: 'tam-order-0001', status, order_reference_id: reference, total_amount: { amount, currency: 'SAR' } }) }
  }
  useMockTamaraTransportForTests(t)
  return reqs
}

describe('Tabby links (development mock)', () => {
  it('checkout → verified by reading the payment → captured once → recorded once on the order', async () => {
    const { mod, customer, orderId, total } = await setup()
    const reqs = mockTabby()
    const link = await createPaymentLink(mod.actor, { provider: 'tabby', orderId, phone: customer.phoneE164, amountHalalas: total, idempotencyKey: 'k-tabby-0001' })
    expect(link).toMatchObject({ status: 'open', checkoutUrl: 'https://checkout.tabby.ai/?sessionId=sess_1' })
    const checkout = reqs[0]!.body as { merchant_code: string; merchant_urls: { success: string }; payment: { buyer: { phone: string }; currency: string } }
    expect(checkout.merchant_code).toBe('PAMPER_SA')
    expect(checkout.payment.currency).toBe('SAR')
    expect(checkout.payment.buyer.phone).toBe(customer.phoneE164.slice(4))
    expect(checkout.merchant_urls.success).toBe('https://test.example/pay/return?provider=tabby')

    // The customer gets a short branded link that opens the gateway's page.
    expect(link.shortUrl).toMatch(/^https:\/\/test\.example\/p\/PL-[A-Z0-9]+$/)
    const ref = link.shortUrl!.split('/p/')[1]!
    expect(await paymentLinkTarget(ref)).toEqual({ kind: 'open', url: 'https://checkout.tabby.ai/?sessionId=sess_1' })
    expect((await paymentLinkWhatsapp(mod.actor, link.id)).text).toContain(link.shortUrl!)
    expect(await paymentLinkTarget('PL-NOPE00')).toEqual({ kind: 'closed' })
    expect(await paymentLinkTarget('../etc')).toEqual({ kind: 'closed' })

    expect(await syncTabbyPayment('pay-tabby-0001')).toBe('paid')
    expect(await paymentLinkTarget(ref)).toEqual({ kind: 'paid' })
    expect(reqs.filter((r) => r.url.endsWith('/captures'))).toHaveLength(1)
    // A repeated notification / return-page visit changes nothing.
    expect(await syncTabbyPayment('pay-tabby-0001')).toBe('duplicate')
    const ps = await getDb().select().from(payments).where(eq(payments.orderId, orderId))
    expect(ps).toHaveLength(1)
    expect(ps[0]).toMatchObject({ method: 'tabby', amountHalalas: total, status: 'confirmed' })
    expect(reqs.filter((r) => r.url.endsWith('/captures'))).toHaveLength(1)
  })

  it('a customer Tabby declines gets a clear "not eligible"; a different amount is never captured', async () => {
    const { mod, customer, orderId } = await setup()
    mockTabby({ rejectCheckout: true })
    const declined = await createPaymentLink(mod.actor, { provider: 'tabby', orderId, phone: customer.phoneE164, amountHalalas: 5000, idempotencyKey: 'k-tabby-0002' })
    expect(declined.status).toBe('failed')
    expect(declined.errorCode).toMatch(/^not_eligible/)

    const reqs = mockTabby({ amountOverride: '1.00' })
    await createPaymentLink(mod.actor, { provider: 'tabby', orderId, phone: customer.phoneE164, amountHalalas: 5000, idempotencyKey: 'k-tabby-0003' })
    expect(await syncTabbyPayment('pay-tabby-0001')).toBe('amount_mismatch')
    expect(reqs.filter((r) => r.url.endsWith('/captures'))).toHaveLength(0)
    expect(await getDb().select().from(payments).where(eq(payments.orderId, orderId))).toHaveLength(0)
  })

  it('no capture for a cancelled order: the authorization is left to expire, nothing is recorded', async () => {
    const { mod, customer, orderId, total } = await setup()
    const reqs = mockTabby()
    await createPaymentLink(mod.actor, { provider: 'tabby', orderId, phone: customer.phoneE164, amountHalalas: total, idempotencyKey: 'k-tabby-0004' })
    await cancelOrder(mod.actor, orderId, { reason: 'customer_request' })
    expect(await syncTabbyPayment('pay-tabby-0001')).toBe('authorized')
    expect(reqs.filter((r) => r.url.endsWith('/captures'))).toHaveLength(0)
    expect(await getDb().select().from(payments).where(eq(payments.orderId, orderId))).toHaveLength(0)
    expect((await getDb().select().from(paymentLinks))[0]!.status).toBe('cancelled')
  })
})

describe('first connection help (development mock)', () => {
  it('Tabby works without the webhook secret, and a refusal shows the provider\'s reason (no keys, no phone)', async () => {
    const { mod, customer, orderId } = await setup()
    const keep = process.env.TABBY_WEBHOOK_SECRET
    delete process.env.TABBY_WEBHOOK_SECRET
    try {
      useMockTabbyTransportForTests(async () => ({ status: 400, json: async () => ({ status: 'error', errorType: 'bad_data', error: 'buyer.email is required for sk_test_abc and 0501234567' }) }))
      const r = await createPaymentLink(mod.actor, { provider: 'tabby', orderId, phone: customer.phoneE164, amountHalalas: 5000, idempotencyKey: 'k-tabby-0009' })
      expect(r.status).toBe('failed')
      expect(r.errorCode).toContain('HTTP 400')
      expect(r.errorCode).toContain('buyer.email is required')
      expect(r.errorCode).not.toContain('sk_test_abc')
      expect(r.errorCode).not.toContain('0501234567')
    } finally {
      process.env.TABBY_WEBHOOK_SECRET = keep
    }
  })
})

describe('Tamara links (development mock)', () => {
  it('approved → authorised → captured → recorded once', async () => {
    const { mod, customer, orderId, total } = await setup()
    const reqs = mockTamara()
    const link = await createPaymentLink(mod.actor, { provider: 'tamara', orderId, phone: customer.phoneE164, amountHalalas: total, idempotencyKey: 'k-tamara-001' })
    expect(link).toMatchObject({ status: 'open', checkoutUrl: 'https://checkout.tamara.co/c1' })
    const body = reqs[0]!.body as { total_amount: { amount: number; currency: string }; merchant_url: { notification: string }; country_code: string }
    expect(body.total_amount).toEqual({ amount: total / 100, currency: 'SAR' })
    expect(body.merchant_url.notification).toBe('https://test.example/api/payments/tamara/webhook')
    expect(await syncTamaraOrder('tam-order-0001')).toBe('paid')
    expect(await syncTamaraOrder('tam-order-0001')).toBe('duplicate')
    expect(reqs.map((r) => r.url.split('/').slice(-2).join('/'))).toEqual(expect.arrayContaining(['tam-order-0001/authorise', 'payments/capture']))
    const ps = await getDb().select().from(payments).where(eq(payments.orderId, orderId))
    expect(ps).toHaveLength(1)
    expect(ps[0]).toMatchObject({ method: 'tamara', amountHalalas: total })
    const [l] = await getDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id))
    expect(l).toMatchObject({ status: 'paid', paidHalalas: total })
  })

  it('notification tokens: only a correctly signed, unexpired HS256 token is accepted', () => {
    const sign = (payload: object, secret = ENV.TAMARA_NOTIFICATION_TOKEN, alg = 'HS256') => {
      const h = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url')
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
      return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`
    }
    const exp = Math.floor(Date.now() / 1000) + 600
    expect(verifyTamaraToken(sign({ iat: 1, exp }))).toBe(true)
    expect(verifyTamaraToken(sign({ exp }, 'wrong-secret'))).toBe(false)
    expect(verifyTamaraToken(sign({ exp: 1 }))).toBe(false)
    expect(verifyTamaraToken(sign({ exp }, ENV.TAMARA_NOTIFICATION_TOKEN, 'none'))).toBe(false)
    expect(verifyTamaraToken(null)).toBe(false)
  })
})
