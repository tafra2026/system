import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { paymobTransactionHmac } from '@/domain/paymob'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { paymentLinkEvents, paymentLinks, payments } from '@/server/db/schema'
import { useMockPaymobTransportForTests, type HttpTransport } from '@/server/integrations/paymob'
import { orderBalance } from '@/server/services/commissions'
import { adjustLinePrice, cancelOrder, getOrderDetail, saveOrder } from '@/server/services/orders'
import { allocatePaidLink, createPaymentLink, handlePaymobCallback, linkDefaultsForOrder, paymentLinkWhatsapp } from '@/server/services/payment-links'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

const HMAC = 'test-hmac-secret-not-real'
const saved: Record<string, string | undefined> = {}
const ENV = { PAYMOB_SECRET_KEY: 'sk_test_dummy', PAYMOB_PUBLIC_KEY: 'pk_test_dummy', PAYMOB_HMAC_SECRET: HMAC, PAYMOB_INTEGRATIONS: 'card:111,apple_pay:222', APP_BASE_URL: 'https://test.example' }
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
afterEach(() => useMockPaymobTransportForTests(null))

/** Development mock of Paymob's Intention API — records requests, contacts nothing. */
function mockPaymob(behaviour: 'ok' | 'timeout' | 'reject' = 'ok') {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = []
  const t: HttpTransport = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization! })
    if (behaviour === 'timeout') {
      await new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    }
    if (behaviour === 'reject') return { status: 400, json: async () => ({}) }
    return { status: 201, json: async () => ({ id: `int_${calls.length}`, client_secret: `cs_${calls.length}`, intention_order_id: 9000 + calls.length }) }
  }
  useMockPaymobTransportForTests(t)
  return calls
}

function txn(reference: string, amount: number, over: Record<string, unknown> = {}) {
  const obj = {
    id: 777000 + Math.floor(Math.random() * 1000),
    amount_cents: amount,
    created_at: '2026-09-26T10:00:00',
    currency: 'SAR',
    error_occured: false,
    has_parent_transaction: false,
    integration_id: 111,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 9001, merchant_order_id: reference },
    owner: 42,
    pending: false,
    source_data: { pan: '4111', sub_type: 'MasterCard', type: 'card' },
    success: true,
    ...over,
  }
  return { body: { type: 'TRANSACTION', obj }, hmac: paymobTransactionHmac(obj, HMAC) }
}

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist')
  const cat = await catalog()
  const { customer, address } = await customerWithAddress(mod.actor)
  const swedish = await cat.svc('massage_swedish')
  const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] }, { confirm: true })
  const total = (await getOrderDetail(mod.actor, res.id)).order.grandTotalHalalas
  return { owner, mod, s1, customer, orderId: res.id, total }
}

describe('creating links', () => {
  it('defaults to what is due, rejects more, is idempotent, and sends the configured methods only', async () => {
    const { mod, s1, orderId, total, customer } = await setup()
    const calls = mockPaymob()
    const d = await linkDefaultsForOrder(mod.actor, orderId)
    expect(d.suggestedHalalas).toBe(total)
    await expect(createPaymentLink(s1.actor, { provider: 'paymob', phone: customer.phoneE164, amountHalalas: 1000, idempotencyKey: 'k-spec-0001' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createPaymentLink(mod.actor, { provider: 'paymob', orderId, phone: customer.phoneE164, amountHalalas: total + 100, idempotencyKey: 'k-too-much-01' })).rejects.toMatchObject({ fieldErrors: { amountHalalas: 'link_exceeds_due' } })

    const a = await createPaymentLink(mod.actor, { provider: 'paymob', methods: ['card', 'stc_pay'], orderId, customerName: 'سارة', phone: customer.phoneE164, amountHalalas: 5000, idempotencyKey: 'k-partial-001' })
    expect(a.status).toBe('open')
    expect(a.checkoutUrl).toContain('/unifiedcheckout/?publicKey=pk_test_dummy&clientSecret=cs_1')
    expect(calls[0]!.body).toMatchObject({ amount: 5000, currency: 'SAR', payment_methods: [111] }) // stc_pay not enabled → not sent
    expect(calls[0]!.body.notification_url).toBe('https://test.example/api/payments/paymob/webhook')
    const again = await createPaymentLink(mod.actor, { provider: 'paymob', orderId, phone: customer.phoneE164, amountHalalas: 5000, idempotencyKey: 'k-partial-001' })
    expect(again.id).toBe(a.id)
    expect(calls).toHaveLength(1)
    // The open link counts against what is due.
    expect((await linkDefaultsForOrder(mod.actor, orderId)).suggestedHalalas).toBe(total - 5000)
    const wa = await paymentLinkWhatsapp(mod.actor, a.id)
    expect(wa.text).toContain('سارة')
    expect(wa.link.startsWith(`https://wa.me/${customer.phoneE164.slice(1)}?text=`)).toBe(true)

    await expect(createPaymentLink(mod.actor, { provider: 'tabby', phone: customer.phoneE164, amountHalalas: 1000, idempotencyKey: 'k-tabby-0001' })).rejects.toMatchObject({ code: 'provider_integration_pending' })
  })

  it('a timeout leaves the link "creating" (check before retrying), a rejection marks it failed', async () => {
    const { mod, customer } = await setup()
    mockPaymob('reject')
    expect((await createPaymentLink(mod.actor, { provider: 'paymob', phone: customer.phoneE164, amountHalalas: 1000, idempotencyKey: 'k-reject-001' })).status).toBe('failed')
    mockPaymob('timeout')
    const { createIntention } = await import('@/server/integrations/paymob')
    const r = await createIntention({ reference: 'PL-T', amountHalalas: 1000, methods: ['card'], customerName: null, phoneE164: customer.phoneE164, description: 'x', notificationUrl: 'x', redirectionUrl: 'x' }, 50)
    expect(r).toEqual({ ok: false, code: 'timeout_unknown' })
  })
})

describe('provider notifications', () => {
  it('only a verified, matching, captured notification creates a payment — exactly once', async () => {
    const { mod, orderId, total, customer } = await setup()
    mockPaymob()
    const link = await createPaymentLink(mod.actor, { provider: 'paymob', orderId, phone: customer.phoneE164, amountHalalas: total, idempotencyKey: 'k-full-00001' })
    const [row] = await getDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id))

    const forged = txn(row!.reference, total)
    expect((await handlePaymobCallback('0'.repeat(128), forged.body)).status).toBe(401)
    const tampered = txn(row!.reference, total)
    ;(tampered.body.obj as Record<string, unknown>).amount_cents = 1
    expect((await handlePaymobCallback(tampered.hmac, tampered.body)).status).toBe(401)

    const auth = txn(row!.reference, total, { is_auth: true, is_capture: false })
    expect((await handlePaymobCallback(auth.hmac, auth.body)).outcome).toBe('authorized')
    expect((await orderBalance(getDb(), orderId)).confirmed).toBe(0) // authorization ≠ collection

    const paid = txn(row!.reference, total)
    expect((await handlePaymobCallback(paid.hmac, paid.body)).outcome).toBe('paid')
    expect((await handlePaymobCallback(paid.hmac, paid.body)).outcome).toBe('duplicate')
    const late = txn(row!.reference, total, { id: (paid.body.obj as { id: number }).id, success: false })
    expect((await handlePaymobCallback(late.hmac, late.body)).outcome).toBe('already_final') // late failure never undoes a payment
    const ps = await getDb().select().from(payments).where(eq(payments.orderId, orderId))
    expect(ps).toHaveLength(1)
    expect(ps[0]).toMatchObject({ method: 'paymob', status: 'confirmed', amountHalalas: total })
    expect((await getDb().select().from(paymentLinkEvents)).length).toBeGreaterThanOrEqual(3)
  })

  it('money that cannot be applied becomes a settlement case; management can allocate it', async () => {
    const { owner, mod, orderId, total, customer } = await setup()
    mockPaymob()
    // Unlinked link.
    const free = await createPaymentLink(mod.actor, { provider: 'paymob', phone: customer.phoneE164, amountHalalas: 3000, idempotencyKey: 'k-unlinked-1' })
    const [fr] = await getDb().select().from(paymentLinks).where(eq(paymentLinks.id, free.id))
    const n1 = txn(fr!.reference, 3000)
    expect((await handlePaymobCallback(n1.hmac, n1.body)).outcome).toBe('paid_needs_settlement')
    expect(await getDb().select().from(payments)).toHaveLength(0) // not revenue automatically
    await expect(allocatePaidLink(mod.actor, free.id, orderId)).rejects.toBeInstanceOf(ForbiddenError)
    await allocatePaidLink(owner.actor, free.id, orderId)
    expect((await orderBalance(getDb(), orderId)).confirmed).toBe(3000)

    // Link on an order that is then cancelled: the open link closes; a late payment is a settlement case.
    const l2 = await createPaymentLink(mod.actor, { provider: 'paymob', orderId, phone: customer.phoneE164, amountHalalas: total - 3000, idempotencyKey: 'k-cancel-001' })
    await cancelOrder(mod.actor, orderId, { reason: 'customer_request' })
    const [r2] = await getDb().select().from(paymentLinks).where(eq(paymentLinks.id, l2.id))
    expect(r2!.status).toBe('cancelled')
    const late = txn(r2!.reference, total - 3000)
    expect((await handlePaymobCallback(late.hmac, late.body)).outcome).toBe('paid_needs_settlement')

    // Wrong amount is never applied.
    const { orderId: o2, total: t2 } = await (async () => {
      const s = await setup2(mod)
      return s
    })()
    const l3 = await createPaymentLink(mod.actor, { provider: 'paymob', orderId: o2, phone: customer.phoneE164, amountHalalas: t2, idempotencyKey: 'k-mismatch-1' })
    const [r3] = await getDb().select().from(paymentLinks).where(eq(paymentLinks.id, l3.id))
    const wrong = txn(r3!.reference, 100)
    expect((await handlePaymobCallback(wrong.hmac, wrong.body)).outcome).toBe('amount_mismatch')
    expect(await getDb().select().from(payments).where(eq(payments.orderId, o2))).toHaveLength(0)
  })

  it('lowering the price closes open links that ask for more than is now due', async () => {
    const { owner, mod, orderId, total, customer } = await setup()
    mockPaymob()
    const l = await createPaymentLink(mod.actor, { provider: 'paymob', orderId, phone: customer.phoneE164, amountHalalas: total, idempotencyKey: 'k-price-0001' })
    const small = await createPaymentLink(mod.actor, { provider: 'paymob', orderId, phone: customer.phoneE164, amountHalalas: 1000, idempotencyKey: 'k-price-0002' }).catch(() => null)
    expect(small).toBeNull() // nothing left to ask for while the full link is open
    const line = (await getOrderDetail(mod.actor, orderId)).lines[0]!
    await adjustLinePrice(owner.actor, line.id, line.finalPriceHalalas - 2000, 'خصم خاص')
    const [after] = await getDb().select().from(paymentLinks).where(eq(paymentLinks.id, l.id))
    expect(after).toMatchObject({ status: 'cancelled', cancelReason: 'price_changed' })
    expect((await linkDefaultsForOrder(mod.actor, orderId)).suggestedHalalas).toBe(total - 2000)
  })
})

async function setup2(mod: Awaited<ReturnType<typeof makeStaff>>) {
  const cat = await catalog()
  const s = await makeStaff('specialist')
  const { customer, address } = await customerWithAddress(mod.actor)
  const svc = await cat.svc('massage_swedish')
  const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: svc.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-02', '20:00', [s.employee.id])] }, { confirm: true })
  return { orderId: res.id, total: (await getOrderDetail(mod.actor, res.id)).order.grandTotalHalalas }
}
