import { createHash } from 'node:crypto'
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { packageSessionBalance } from '@/domain/order'
import type { Locale } from '@/i18n'
import { authorize, type Actor } from '../authz/actor'
import { newToken, sha256 } from '../auth/crypto'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { customerDocumentLinks, customerDocuments, customers, orderLines, orders, packageSessions, payments, visits } from '../db/schema'
import { renderCustomerDocument, type CustomerDocSnapshot } from '../pdf/customer-document'
import { NotFoundError, ValidationError } from './errors'
import { getSetting } from './settings'

/** Customer download links stay valid this long (can be revoked earlier). */
export const DOCUMENT_LINK_DAYS = 30

/** The data a document shows, read from what is saved on the server (never from the browser). */
async function buildContent(tx: Executor, orderId: string, locale: Locale) {
  const [row] = await tx.select({ o: orders, customerName: customers.name }).from(orders).innerJoin(customers, eq(customers.id, orders.customerId)).where(eq(orders.id, orderId))
  if (!row) throw new NotFoundError()
  const o = row.o
  if (o.status === 'draft') throw new ValidationError('order_is_draft')
  const vs = await tx.select().from(visits).where(eq(visits.orderId, orderId)).orderBy(asc(visits.sequence))
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(asc(orderLines.sortOrder))
  const sessions = await tx.select().from(packageSessions).where(sql`${packageSessions.orderLineId} IN (SELECT id FROM order_lines WHERE order_id = ${orderId})`)
  const paid = await tx
    .select({ method: payments.method, amountHalalas: payments.amountHalalas, receivedAt: payments.receivedAt })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'confirmed')))
    .orderBy(asc(payments.receivedAt))
  const paidTotal = paid.reduce((a, p) => a + p.amountHalalas, 0)
  const remaining = Math.max(0, o.grandTotalHalalas - paidTotal)
  return {
    locale,
    orderReference: o.reference,
    orderStatus: o.status,
    customerName: row.customerName,
    visits: vs.map((v) => ({ sequence: v.sequence, startsAt: v.startsAt?.toISOString() ?? null, status: v.status })),
    lines: lines.map((l) => {
      const ls = sessions.filter((s) => s.orderLineId === l.id)
      const bal = l.kind === 'package' ? packageSessionBalance(ls.length, ls.map((s) => vs.find((v) => v.id === s.visitId)?.status ?? 'unscheduled')) : null
      return {
        name: locale === 'en' ? l.nameEn : l.nameAr,
        kind: l.kind,
        beneficiary: l.beneficiaryIndex,
        baseHalalas: l.basePriceHalalas,
        offerHalalas: l.offerPriceHalalas,
        vipDiscountHalalas: l.vipDiscountHalalas,
        adjustmentHalalas: l.finalPriceHalalas - l.priceAfterVipHalalas,
        finalHalalas: l.finalPriceHalalas,
        sessions: bal ? { total: bal.total, used: bal.used, cancelled: bal.cancelled } : null,
      }
    }),
    servicesTotalHalalas: o.servicesTotalHalalas,
    deliveryFeeHalalas: o.deliveryFeeHalalas,
    grandTotalHalalas: o.grandTotalHalalas,
    payments: paid.map((p) => ({ method: p.method, amountHalalas: p.amountHalalas, receivedAt: p.receivedAt.toISOString() })),
    paidHalalas: paidTotal,
    remainingHalalas: remaining,
    paymentStatus: (remaining === 0 ? 'paid' : paidTotal > 0 ? 'partial' : 'unpaid') as CustomerDocSnapshot['paymentStatus'],
    contact: await getSetting(tx, 'business_contact'),
  }
}

function hashContent(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

/**
 * Issue (or re-use) the customer document for an order in a language. If nothing changed
 * since the last version, that version is returned — double taps never create copies. If the
 * order changed, a new version with a new number is issued; old versions stay as they were.
 */
export async function issueCustomerDocument(actor: Actor, orderId: string, localeInput: unknown) {
  authorize(actor, 'orders.manage')
  if (!z.uuid().safeParse(orderId).success) throw new NotFoundError()
  const locale = z.enum(['ar', 'en']).parse(localeInput)
  return getDb().transaction(async (tx) => {
    // Serialise issues per order so two taps cannot create two versions.
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for('update')
    const content = await buildContent(tx, orderId, locale)
    const contentHash = hashContent(content)
    const [latest] = await tx
      .select()
      .from(customerDocuments)
      .where(and(eq(customerDocuments.orderId, orderId), eq(customerDocuments.locale, locale)))
      .orderBy(desc(customerDocuments.version))
      .limit(1)
    if (latest && latest.contentHash === contentHash) return { id: latest.id, number: latest.number, version: latest.version, reused: true }
    const [{ n }] = (await tx.execute<{ n: string }>(sql`SELECT nextval('customer_document_seq')::text AS n`)).rows as [{ n: string }]
    const issuedAt = new Date()
    const yymm = issuedAt.toISOString().slice(2, 4) + issuedAt.toISOString().slice(5, 7)
    const number = `PMD-${yymm}-${n.padStart(4, '0')}`
    const version = (latest?.version ?? 0) + 1
    const snapshot: CustomerDocSnapshot = { ...content, number, version, issuedAt: issuedAt.toISOString() }
    const [doc] = await tx.insert(customerDocuments).values({ orderId, number, version, locale, snapshot, contentHash, issuedByUserId: actor.userId, issuedAt }).returning()
    await writeAudit(tx, { actorUserId: actor.userId, action: 'document.issue', entityType: 'order', entityId: orderId, after: { number, version, locale } })
    return { id: doc!.id, number, version, reused: false }
  })
}

export async function listCustomerDocuments(actor: Actor, orderId: string) {
  authorize(actor, 'orders.read.all')
  return getDb()
    .select({ id: customerDocuments.id, number: customerDocuments.number, version: customerDocuments.version, locale: customerDocuments.locale, issuedAt: customerDocuments.issuedAt })
    .from(customerDocuments)
    .where(eq(customerDocuments.orderId, orderId))
    .orderBy(desc(customerDocuments.issuedAt))
}

/** Staff download (permission-checked). */
export async function customerDocumentPdf(actor: Actor, documentId: string) {
  authorize(actor, 'orders.read.all')
  if (!z.uuid().safeParse(documentId).success) throw new NotFoundError()
  const [d] = await getDb().select().from(customerDocuments).where(eq(customerDocuments.id, documentId))
  if (!d) throw new NotFoundError()
  return { number: d.number, pdf: await renderCustomerDocument(d.snapshot as CustomerDocSnapshot) }
}

/** A private download link for the customer: random token (stored hashed), expires, revocable. */
export async function createDocumentLink(actor: Actor, documentId: string) {
  authorize(actor, 'orders.manage')
  if (!z.uuid().safeParse(documentId).success) throw new NotFoundError()
  const db = getDb()
  const [d] = await db
    .select({ id: customerDocuments.id, number: customerDocuments.number, locale: customerDocuments.locale, orderId: customerDocuments.orderId, phone: customers.phoneE164, name: customers.name, messageLocale: customers.messageLocale })
    .from(customerDocuments)
    .innerJoin(orders, eq(orders.id, customerDocuments.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(customerDocuments.id, documentId))
  if (!d) throw new NotFoundError()
  const token = newToken()
  const expiresAt = new Date(Date.now() + DOCUMENT_LINK_DAYS * 86_400_000)
  await db.insert(customerDocumentLinks).values({ documentId, tokenHash: sha256(token), expiresAt, createdByUserId: actor.userId })
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return { url: `${base}/d/${token}`, expiresAt, number: d.number, phone: d.phone, name: d.name, locale: d.locale }
}

export async function revokeDocumentLinks(actor: Actor, documentId: string) {
  authorize(actor, 'orders.manage')
  await getDb().update(customerDocumentLinks).set({ revokedAt: new Date() }).where(and(eq(customerDocumentLinks.documentId, documentId), isNull(customerDocumentLinks.revokedAt)))
}

/** Public download by token. Unknown, expired and revoked tokens all look the same. */
export async function customerDocumentByToken(token: string) {
  if (!token || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null
  const [row] = await getDb()
    .select({ d: customerDocuments })
    .from(customerDocumentLinks)
    .innerJoin(customerDocuments, eq(customerDocuments.id, customerDocumentLinks.documentId))
    .where(and(eq(customerDocumentLinks.tokenHash, sha256(token)), isNull(customerDocumentLinks.revokedAt), gt(customerDocumentLinks.expiresAt, new Date())))
  if (!row) return null
  return { number: row.d.number, pdf: await renderCustomerDocument(row.d.snapshot as CustomerDocSnapshot) }
}
