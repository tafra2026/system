import { randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { classifyPaymobTransaction, paymobAuditSummary, verifyPaymobHmac, type ProviderOutcome } from '@/domain/paymob'
import { normalizePhone } from '@/domain/phone'
import { formatMoney } from '@/i18n/format'
import { whatsappChatLink } from '@/domain/messages'
import { authorize, type Actor } from '../authz/actor'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { customers, orders, paymentLinkEvents, paymentLinks, payments, type PaymentLink } from '../db/schema'
import { createIntention, paymobConfigured, paymobHmacSecret, paymobIntegrations, PAYMOB_METHODS, type PaymobMethod } from '../integrations/paymob'
import { orderBalance, syncCommissions } from './commissions'
import { NotFoundError, ValidationError } from './errors'
import { notifyPaymentDecision } from './notifications'
import { parseWith } from './validation'

/**
 * Online payment links (spec §12 + Paymob). Rules:
 * - A link is a request, not money. Only a VERIFIED provider notification creates a payment.
 * - Retries/duplicate notifications are harmless (unique event key + unique payment key + row lock).
 * - An authorization that is not captured is not collected money.
 * - Money that cannot be applied (no order, cancelled order, more than what is still due) is
 *   kept on the link as "needs settlement" for management — never counted as service revenue
 *   or commission automatically.
 */

export type ProviderKey = 'paymob' | 'tabby' | 'tamara'

export interface ProviderState {
  provider: ProviderKey
  configured: boolean
  methods: string[]
  /** Why it cannot be used yet (shown to staff instead of a fake success). */
  missing?: 'keys' | 'integration_pending'
}

export function providerStates(): ProviderState[] {
  return [
    { provider: 'paymob', configured: paymobConfigured(), methods: [...paymobIntegrations().keys()], ...(paymobConfigured() ? {} : { missing: 'keys' as const }) },
    // Tabby and Tamara stay manual (recorded with a reference) until their direct integrations
    // are built with the merchant accounts and official docs (docs/INTEGRATIONS.ar.md).
    { provider: 'tabby', configured: false, methods: [], missing: 'integration_pending' },
    { provider: 'tamara', configured: false, methods: [], missing: 'integration_pending' },
  ]
}

const OPEN: PaymentLink['status'][] = ['creating', 'open', 'authorized']

function publicBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

function newReference(): string {
  return `PL-${randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`
}

/** Still due on an order after confirmed payments and other open links. */
async function dueForNewLink(tx: Executor, orderId: string, exceptLinkId?: string) {
  const bal = await orderBalance(tx, orderId)
  const [open] = await tx
    .select({ sum: sql<number>`coalesce(sum(${paymentLinks.amountHalalas}), 0)`.mapWith(Number) })
    .from(paymentLinks)
    .where(and(eq(paymentLinks.orderId, orderId), inArray(paymentLinks.status, OPEN), exceptLinkId ? sql`${paymentLinks.id} <> ${exceptLinkId}` : undefined))
  return { remaining: bal.total - bal.confirmed - bal.pending, openLinks: open?.sum ?? 0 }
}

// ─────────────────────────────── Creating a link ───────────────────────────────

const createSchema = z.object({
  provider: z.enum(['paymob', 'tabby', 'tamara']),
  methods: z.array(z.enum(PAYMOB_METHODS)).max(3).default([]),
  orderId: z.uuid().nullable().optional(),
  customerName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().min(1).max(40),
  amountHalalas: z.number().int().min(100).max(10_000_000),
  description: z.string().trim().max(250).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(80),
})

export interface CreatedLink {
  id: string
  status: PaymentLink['status']
  checkoutUrl: string | null
  errorCode: string | null
}

export async function createPaymentLink(actor: Actor, raw: unknown): Promise<CreatedLink> {
  authorize(actor, 'payments.links')
  const input = parseWith(createSchema, raw)
  const phone = normalizePhone(input.phone)
  if (!phone) throw new ValidationError('validation_failed', { phone: 'phone_invalid' })
  const state = providerStates().find((p) => p.provider === input.provider)!
  if (!state.configured) throw new ValidationError(state.missing === 'integration_pending' ? 'provider_integration_pending' : 'provider_not_configured')
  const methods = input.methods.filter((m) => state.methods.includes(m)) as PaymobMethod[]
  const useMethods = methods.length ? methods : (state.methods as PaymobMethod[])

  const db = getDb()
  // Step 1 (committed before calling the provider): the link row, validated against the order.
  const prepared = await db.transaction(async (tx) => {
    const [dup] = await tx.select().from(paymentLinks).where(eq(paymentLinks.idempotencyKey, input.idempotencyKey))
    if (dup) return { dup }
    let orderRef: string | null = null
    if (input.orderId) {
      const [o] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for('update')
      if (!o) throw new NotFoundError()
      if (o.status === 'draft') throw new ValidationError('order_is_draft')
      if (o.status === 'cancelled') throw new ValidationError('order_cancelled')
      const due = await dueForNewLink(tx, o.id)
      if (input.amountHalalas > due.remaining - due.openLinks) {
        throw new ValidationError('validation_failed', { amountHalalas: 'link_exceeds_due' })
      }
      orderRef = o.reference
    }
    const [link] = await tx
      .insert(paymentLinks)
      .values({
        reference: newReference(),
        provider: input.provider,
        methods: useMethods,
        orderId: input.orderId ?? null,
        customerName: input.customerName || null,
        customerPhoneE164: phone,
        amountHalalas: input.amountHalalas,
        description: input.description || (orderRef ? `Pamper Me ${orderRef}` : 'Pamper Me'),
        status: 'creating',
        idempotencyKey: input.idempotencyKey,
        createdByUserId: actor.userId,
      })
      .returning()
    await writeAudit(tx, { actorUserId: actor.userId, action: 'payment_link.create', entityType: 'order', entityId: input.orderId ?? link!.id, after: { link: link!.id, provider: input.provider, amountHalalas: input.amountHalalas } })
    return { link: link! }
  })
  if ('dup' in prepared && prepared.dup) return toCreated(prepared.dup)
  const link = prepared.link!

  // Step 2: the provider call, outside any transaction.
  const res = await createIntention({
    reference: link.reference,
    amountHalalas: link.amountHalalas,
    methods: useMethods,
    customerName: link.customerName,
    phoneE164: link.customerPhoneE164,
    description: link.description ?? 'Pamper Me',
    notificationUrl: `${publicBaseUrl()}/api/payments/paymob/webhook`,
    redirectionUrl: `${publicBaseUrl()}/pay/return`,
  })
  const [updated] = await db
    .update(paymentLinks)
    .set(
      res.ok
        ? { status: 'open', providerRef: res.providerRef, checkoutUrl: res.checkoutUrl, errorCode: null, updatedAt: new Date() }
        : // After a timeout the provider may have created it: stay "creating" and ask to check.
          { status: res.code === 'timeout_unknown' ? 'creating' : 'failed', errorCode: res.code, updatedAt: new Date() },
    )
    .where(and(eq(paymentLinks.id, link.id), eq(paymentLinks.status, 'creating')))
    .returning()
  return toCreated(updated ?? link)
}

function toCreated(l: PaymentLink): CreatedLink {
  return { id: l.id, status: l.status, checkoutUrl: l.checkoutUrl, errorCode: l.errorCode }
}

// ─────────────────────────────── Provider notifications ───────────────────────────────

export type WebhookResult = { status: 200 | 401 | 400; outcome: string }

/**
 * Paymob transaction callback. Verified by HMAC; amount, currency and our reference are
 * checked against the stored link before anything is recorded. Order of arrival does not
 * matter: a paid link never goes back, duplicates are ignored.
 */
export async function handlePaymobCallback(hmac: string | null, body: unknown): Promise<WebhookResult> {
  const obj = (body as { obj?: unknown })?.obj
  if (!obj || typeof obj !== 'object') return { status: 400, outcome: 'malformed' }
  const tx0 = obj as Record<string, unknown>
  if (!verifyPaymobHmac(obj, hmac, paymobHmacSecret())) return { status: 401, outcome: 'bad_signature' }
  const outcome = classifyPaymobTransaction(tx0)
  const summary = paymobAuditSummary(tx0)
  const txnId = summary.id
  if (!txnId) return { status: 400, outcome: 'malformed' }

  return getDb().transaction(async (tx) => {
    const eventKey = `paymob:${txnId}:${outcome}`
    const [seen] = await tx.select({ id: paymentLinkEvents.id }).from(paymentLinkEvents).where(eq(paymentLinkEvents.eventKey, eventKey))
    if (seen) return { status: 200 as const, outcome: 'duplicate' }

    const ref = summary.merchant_order_id
    const [link] = await tx
      .select()
      .from(paymentLinks)
      .where(and(eq(paymentLinks.provider, 'paymob'), ref ? eq(paymentLinks.reference, ref) : eq(paymentLinks.providerRef, summary.order_id)))
      .for('update')
    const record = (result: string) => tx.insert(paymentLinkEvents).values({ provider: 'paymob', linkId: link?.id ?? null, eventKey, verified: true, outcome: result, summary }).onConflictDoNothing()
    if (!link) {
      await record('unknown_link')
      return { status: 200 as const, outcome: 'unknown_link' }
    }
    if (summary.currency !== 'SAR' || Number(summary.amount_cents) !== link.amountHalalas) {
      await record('amount_mismatch')
      await tx.update(paymentLinks).set({ needsSettlement: true, settlementNote: 'amount_mismatch', providerStatus: outcome, updatedAt: new Date() }).where(eq(paymentLinks.id, link.id))
      return { status: 200 as const, outcome: 'amount_mismatch' }
    }
    const result = await applyOutcome(tx, link, outcome, txnId)
    await record(result)
    return { status: 200 as const, outcome: result }
  })
}

async function applyOutcome(tx: Executor, link: PaymentLink, outcome: ProviderOutcome, txnId: string): Promise<string> {
  const now = new Date()
  const base = { providerStatus: outcome, providerTxnId: txnId, updatedAt: now }
  if (link.status === 'paid' || link.status === 'refunded') {
    if (outcome === 'refunded' && link.status === 'paid') {
      // Money went back to the customer: management must reverse/settle it explicitly.
      await tx.update(paymentLinks).set({ ...base, status: 'refunded', needsSettlement: true, settlementNote: 'refunded_by_provider' }).where(eq(paymentLinks.id, link.id))
      return 'refunded'
    }
    return 'already_final'
  }
  if (outcome === 'pending') {
    await tx.update(paymentLinks).set(base).where(eq(paymentLinks.id, link.id))
    return 'pending'
  }
  if (outcome === 'failed' || outcome === 'voided') {
    // A failed attempt: the customer may try again on the same checkout while it is open.
    await tx.update(paymentLinks).set(base).where(eq(paymentLinks.id, link.id))
    return outcome
  }
  if (outcome === 'authorized') {
    await tx.update(paymentLinks).set({ ...base, status: 'authorized' }).where(eq(paymentLinks.id, link.id))
    return 'authorized'
  }
  if (outcome === 'refunded') {
    await tx.update(paymentLinks).set({ ...base, status: 'refunded' }).where(eq(paymentLinks.id, link.id))
    return 'refunded'
  }
  // paid (captured)
  const paymentId = link.orderId ? await applyToOrder(tx, link, txnId) : null
  await tx
    .update(paymentLinks)
    .set({
      ...base,
      status: 'paid',
      paidHalalas: link.amountHalalas,
      paidAt: now,
      paymentId,
      needsSettlement: paymentId == null,
      settlementNote: paymentId == null ? (link.orderId ? 'cannot_apply_to_order' : 'unlinked') : null,
    })
    .where(eq(paymentLinks.id, link.id))
  return paymentId ? 'paid' : 'paid_needs_settlement'
}

/** Record the payment on the order when it fits what is still due; null otherwise. */
async function applyToOrder(tx: Executor, link: PaymentLink, txnId: string): Promise<string | null> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, link.orderId!)).for('update')
  if (!o || o.status === 'draft' || o.status === 'cancelled') return null
  const key = `paymob:${txnId}`
  const [dup] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.idempotencyKey, key))
  if (dup) return dup.id
  const bal = await orderBalance(tx, o.id)
  if (link.amountHalalas > bal.total - bal.confirmed - bal.pending) return null
  const [p] = await tx
    .insert(payments)
    .values({
      orderId: o.id,
      method: 'paymob',
      amountHalalas: link.amountHalalas,
      status: 'confirmed',
      receivedAt: new Date(),
      reference: txnId,
      idempotencyKey: key,
      recordedByUserId: link.createdByUserId,
      decidedAt: new Date(),
      notes: link.reference,
    })
    .returning()
  await writeAudit(tx, { actorUserId: null, action: 'payment.record', entityType: 'order', entityId: o.id, after: { payment: p!.id, method: 'paymob', amountHalalas: p!.amountHalalas, status: 'confirmed', link: link.id } })
  await syncCommissions(tx, o.id)
  await notifyPaymentDecision(tx, { orderId: o.id, amountHalalas: p!.amountHalalas, recordedByUserId: link.createdByUserId }, true, null)
  return p!.id
}

// ─────────────────────────────── Order changes & management ───────────────────────────────

/** Cancelled order: open links are closed here (a later payment becomes a settlement case). */
export async function cancelOpenPaymentLinks(tx: Executor, orderId: string, reason = 'order_cancelled') {
  await tx
    .update(paymentLinks)
    .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() })
    .where(and(eq(paymentLinks.orderId, orderId), inArray(paymentLinks.status, ['creating', 'open'])))
}

/** After a price change: open links asking for more than is now due are cancelled. */
export async function reviewOpenLinksAfterPriceChange(tx: Executor, orderId: string) {
  const open = await tx.select().from(paymentLinks).where(and(eq(paymentLinks.orderId, orderId), inArray(paymentLinks.status, ['creating', 'open'])))
  let { remaining } = await dueForNewLink(tx, orderId)
  for (const l of open.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (l.amountHalalas <= remaining) remaining -= l.amountHalalas
    else await tx.update(paymentLinks).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'price_changed', updatedAt: new Date() }).where(eq(paymentLinks.id, l.id))
  }
}

export async function cancelPaymentLink(actor: Actor, linkId: string) {
  authorize(actor, 'payments.links')
  if (!z.uuid().safeParse(linkId).success) throw new NotFoundError()
  await getDb().transaction(async (tx) => {
    const [l] = await tx.select().from(paymentLinks).where(eq(paymentLinks.id, linkId)).for('update')
    if (!l) throw new NotFoundError()
    if (!['creating', 'open', 'failed'].includes(l.status)) throw new ValidationError('link_not_cancellable')
    await tx.update(paymentLinks).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'manual', updatedAt: new Date() }).where(eq(paymentLinks.id, linkId))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'payment_link.cancel', entityType: 'order', entityId: l.orderId ?? l.id, after: { link: l.id } })
  })
}

/** Management applies a paid-but-unallocated link to an order (within what is due). */
export async function allocatePaidLink(actor: Actor, linkId: string, orderId: string) {
  authorize(actor, 'payments.approve_transfer')
  if (!z.uuid().safeParse(linkId).success || !z.uuid().safeParse(orderId).success) throw new NotFoundError()
  await getDb().transaction(async (tx) => {
    const [l] = await tx.select().from(paymentLinks).where(eq(paymentLinks.id, linkId)).for('update')
    if (!l) throw new NotFoundError()
    if (l.status !== 'paid' || !l.needsSettlement || l.paymentId) throw new ValidationError('link_not_allocatable')
    const paymentId = await applyToOrder(tx, { ...l, orderId }, l.providerTxnId ?? l.reference)
    if (!paymentId) throw new ValidationError('validation_failed', { orderId: 'link_exceeds_due' })
    await tx.update(paymentLinks).set({ orderId, paymentId, needsSettlement: false, settledAt: new Date(), settledByUserId: actor.userId, updatedAt: new Date() }).where(eq(paymentLinks.id, linkId))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'payment_link.allocate', entityType: 'order', entityId: orderId, after: { link: l.id, amountHalalas: l.amountHalalas } })
  })
}

/** Management records how a settlement case was resolved outside the system (e.g. refunded). */
export async function markLinkSettled(actor: Actor, linkId: string, note: string) {
  authorize(actor, 'payments.approve_transfer')
  const text = note?.trim()
  if (!text) throw new ValidationError('validation_failed', { note: 'required' })
  const [l] = await getDb()
    .update(paymentLinks)
    .set({ needsSettlement: false, settlementNote: text.slice(0, 500), settledAt: new Date(), settledByUserId: actor.userId, updatedAt: new Date() })
    .where(and(eq(paymentLinks.id, linkId), eq(paymentLinks.needsSettlement, true)))
    .returning({ id: paymentLinks.id })
  if (!l) throw new NotFoundError()
}

// ─────────────────────────────── Listing & sharing ───────────────────────────────

export type LinkListFilter = 'all' | 'open' | 'paid' | 'unlinked' | 'settlement'

export async function listPaymentLinks(actor: Actor, filter: LinkListFilter = 'all', orderId?: string) {
  authorize(actor, 'payments.links')
  const where =
    filter === 'open'
      ? inArray(paymentLinks.status, OPEN)
      : filter === 'paid'
        ? eq(paymentLinks.status, 'paid')
        : filter === 'unlinked'
          ? sql`${paymentLinks.orderId} IS NULL`
          : filter === 'settlement'
            ? eq(paymentLinks.needsSettlement, true)
            : undefined
  return getDb()
    .select({ l: paymentLinks, orderReference: orders.reference })
    .from(paymentLinks)
    .leftJoin(orders, eq(orders.id, paymentLinks.orderId))
    .where(and(where, orderId ? eq(paymentLinks.orderId, orderId) : undefined))
    .orderBy(desc(paymentLinks.createdAt))
    .limit(200)
}

/** Defaults when a link is opened from an order: name, phone, and the amount still due. */
export async function linkDefaultsForOrder(actor: Actor, orderId: string) {
  authorize(actor, 'payments.links')
  if (!z.uuid().safeParse(orderId).success) throw new NotFoundError()
  const db = getDb()
  const [row] = await db.select({ o: orders, name: customers.name, phone: customers.phoneE164 }).from(orders).innerJoin(customers, eq(customers.id, orders.customerId)).where(eq(orders.id, orderId))
  if (!row) throw new NotFoundError()
  const due = await dueForNewLink(db, orderId)
  return { orderId, reference: row.o.reference, status: row.o.status, customerName: row.name, phone: row.phone, suggestedHalalas: Math.max(0, due.remaining - due.openLinks) }
}

/** WhatsApp text with the customer's name and the link (the staff member presses send). */
export async function paymentLinkWhatsapp(actor: Actor, linkId: string) {
  authorize(actor, 'payments.links')
  if (!z.uuid().safeParse(linkId).success) throw new NotFoundError()
  const db = getDb()
  const [row] = await db
    .select({ l: paymentLinks, orderRef: orders.reference, locale: customers.messageLocale })
    .from(paymentLinks)
    .leftJoin(orders, eq(orders.id, paymentLinks.orderId))
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(paymentLinks.id, linkId))
  if (!row?.l.checkoutUrl || !['open', 'creating'].includes(row.l.status)) throw new ValidationError('link_not_open')
  const locale = row.locale ?? 'ar'
  const name = row.l.customerName?.trim()
  const amount = formatMoney(row.l.amountHalalas, locale)
  const text =
    locale === 'en'
      ? [`Hi${name ? ` ${name}` : ''} 🌸`, `Here is your Pamper Me payment link${row.orderRef ? ` for order ${row.orderRef}` : ''} (${amount}):`, row.l.checkoutUrl].join('\n')
      : [`هلا${name ? ` ${name}` : ''} 🌸`, `هذا رابط الدفع من Pamper Me${row.orderRef ? ` لطلبك ${row.orderRef}` : ''} بمبلغ ${amount}:`, row.l.checkoutUrl].join('\n')
  return { text, link: whatsappChatLink(row.l.customerPhoneE164, text) }
}
