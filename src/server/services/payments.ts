import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { cashHandovers, customers, employees, orders, payments, visits, visitSpecialists } from '../db/schema'
import { orderBalance, syncCommissions } from './commissions'
import { notifyPaymentDecision, notifyTransferPending } from './notifications'
import { NotFoundError, ValidationError } from './errors'
import { parseWith, pgErrorCode } from './validation'

const recordSchema = z.object({
  method: z.enum(['cash', 'bank_transfer', 'pos', 'tabby', 'tamara']),
  amountHalalas: z.number().int().min(1).max(10_000_000),
  receivedAt: z.coerce.date().optional(),
  reference: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => v || null),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .nullable()
    .transform((v) => v || null),
  isDeposit: z.boolean().default(false),
  /** One key per form submission: a double tap returns the first result. */
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
})

async function isOnOrder(db: Executor, employeeId: string, orderId: string) {
  const [row] = await db
    .select({ id: visitSpecialists.id })
    .from(visitSpecialists)
    .innerJoin(visits, eq(visits.id, visitSpecialists.visitId))
    .where(and(eq(visits.orderId, orderId), eq(visitSpecialists.employeeId, employeeId)))
    .limit(1)
  return Boolean(row)
}

/**
 * Record a payment (spec §12).
 * - Cash / POS: specialists on the order and management. Cash stays in the recorder's custody.
 * - Bank transfer: recorded as pending; the owner/manager approves it (their own entry is approved directly).
 * - Tabby / Tamara: created through payment links (phase 5); until then management may record
 *   a confirmed provider payment manually with its reference.
 * Never lets confirmed + pending exceed the order total.
 */
export async function recordPayment(actor: Actor, orderId: string, raw: unknown) {
  const input = parseWith(recordSchema, raw)
  const db = getDb()
  if (input.method === 'cash' || input.method === 'pos') {
    authorize(actor, 'payments.record_cash_pos')
    if (actor.role === 'specialist' && !(await isOnOrder(db, actor.employeeId, orderId))) throw new ForbiddenError('payments.record_cash_pos')
    if (input.method === 'pos' && !input.reference) throw new ValidationError('validation_failed', { reference: 'required' })
  } else if (input.method === 'bank_transfer') {
    if (!can(actor, 'orders.manage')) throw new ForbiddenError('orders.manage')
  } else {
    authorize(actor, 'payments.approve_transfer')
    if (!input.reference) throw new ValidationError('validation_failed', { reference: 'required' })
  }
  const receivedAt = input.receivedAt ?? new Date()
  if (receivedAt.getTime() > Date.now() + 5 * 60_000) throw new ValidationError('validation_failed', { receivedAt: 'future_time' })
  const confirmedNow = input.method !== 'bank_transfer' || can(actor, 'payments.approve_transfer')

  try {
    return await db.transaction(async (tx) => {
      // Lock the order first, then check for a duplicate: concurrent retries queue on the lock.
      const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
      if (!o) throw new NotFoundError()
      if (input.idempotencyKey) {
        const [dup] = await tx.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey))
        if (dup) {
          if (dup.orderId !== orderId || dup.amountHalalas !== input.amountHalalas) throw new ValidationError('idempotency_mismatch')
          return dup
        }
      }
      if (o.status === 'draft') throw new ValidationError('order_is_draft')
      const bal = await orderBalance(tx, orderId)
      if (bal.confirmed + bal.pending + input.amountHalalas > bal.total) throw new DomainError('overpayment', { remaining: (bal.total - bal.confirmed - bal.pending) / 100 })
      const [p] = await tx
        .insert(payments)
        .values({
          orderId,
          method: input.method,
          amountHalalas: input.amountHalalas,
          status: confirmedNow ? 'confirmed' : 'pending',
          isDeposit: input.isDeposit,
          receivedAt,
          reference: input.reference,
          notes: input.notes,
          cashHolderEmployeeId: input.method === 'cash' ? actor.employeeId : null,
          idempotencyKey: input.idempotencyKey ?? null,
          recordedByUserId: actor.userId,
          ...(confirmedNow ? { decidedByUserId: actor.userId, decidedAt: new Date() } : {}),
        })
        .returning()
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: 'payment.record',
        entityType: 'order',
        entityId: orderId,
        after: { payment: p!.id, method: p!.method, amountHalalas: p!.amountHalalas, status: p!.status, isDeposit: p!.isDeposit },
      })
      if (confirmedNow) await syncCommissions(tx, orderId)
      else await notifyTransferPending(tx, o.reference, p!.amountHalalas, actor.userId)
      return p!
    })
  } catch (err) {
    // Two identical submissions racing: return the one that won.
    if (pgErrorCode(err) === '23505' && input.idempotencyKey) {
      const [dup] = await db.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey))
      if (dup) return dup
    }
    throw err
  }
}

/** Owner/manager approves or rejects a pending bank transfer. */
export async function decideTransfer(actor: Actor, paymentId: string, approve: boolean, reason: string | null) {
  authorize(actor, 'payments.approve_transfer')
  if (!approve && !reason?.trim()) throw new ValidationError('validation_failed', { reason: 'required' })
  await getDb().transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update')
    if (!p) throw new NotFoundError()
    if (p.status !== 'pending') return
    await tx
      .update(payments)
      .set({ status: approve ? 'confirmed' : 'rejected', decidedByUserId: actor.userId, decidedAt: new Date(), rejectReason: approve ? null : reason!.trim() })
      .where(eq(payments.id, paymentId))
    await writeAudit(tx, { actorUserId: actor.userId, action: approve ? 'payment.approve' : 'payment.reject', entityType: 'order', entityId: p.orderId, after: { payment: p.id, amountHalalas: p.amountHalalas }, reason })
    if (approve) await syncCommissions(tx, p.orderId)
    await notifyPaymentDecision(tx, p, approve, actor.userId)
  })
}

export async function orderPayments(actor: Actor, orderId: string) {
  const db = getDb()
  if (!can(actor, 'orders.read.all')) {
    if (!can(actor, 'payments.record_cash_pos') || !(await isOnOrder(db, actor.employeeId, orderId))) throw new ForbiddenError('orders.read.all')
  }
  const rows = await db
    .select({ p: payments, holderName: employees.fullName, holderNameEn: employees.displayNameEn })
    .from(payments)
    .leftJoin(employees, eq(employees.id, payments.cashHolderEmployeeId))
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.receivedAt))
  return { payments: rows.map((r) => ({ ...r.p, holderName: r.holderName ? (actor.locale === 'en' && r.holderNameEn ? r.holderNameEn : r.holderName) : null })), balance: await orderBalance(db, orderId) }
}

export async function pendingTransfers(actor: Actor) {
  authorize(actor, 'payments.approve_transfer')
  return getDb()
    .select({ id: payments.id, orderId: payments.orderId, reference: orders.reference, customerName: customers.name, amountHalalas: payments.amountHalalas, receivedAt: payments.receivedAt, paymentReference: payments.reference, notes: payments.notes })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(payments.status, 'pending'))
    .orderBy(asc(payments.receivedAt))
}

// ─────────────────────────────── Cash custody ───────────────────────────────

async function outstandingCash(db: Executor, employeeId?: string) {
  return db
    .select({ id: payments.id, holder: payments.cashHolderEmployeeId, amount: payments.amountHalalas, receivedAt: payments.receivedAt, orderId: payments.orderId, reference: orders.reference })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.method, 'cash'), eq(payments.status, 'confirmed'), isNull(payments.cashHandoverId), employeeId ? eq(payments.cashHolderEmployeeId, employeeId) : undefined))
    .orderBy(asc(payments.receivedAt))
}

/** Cash each employee holds (management). The receiver's own direct receipts are shown too. */
export async function custodySummary(actor: Actor) {
  authorize(actor, 'cash.receive_handover')
  const db = getDb()
  const rows = await outstandingCash(db)
  const ids = [...new Set(rows.map((r) => r.holder!))]
  const emps = ids.length ? await db.select().from(employees).where(inArray(employees.id, ids)) : []
  return ids.map((id) => {
    const e = emps.find((x) => x.id === id)!
    const list = rows.filter((r) => r.holder === id)
    return { employeeId: id, name: actor.locale === 'en' && e.displayNameEn ? e.displayNameEn : e.fullName, role: e.role, totalHalalas: list.reduce((a, r) => a + r.amount, 0), payments: list }
  })
}

export async function myCustody(actor: Actor) {
  authorize(actor, 'payments.record_cash_pos')
  const rows = await outstandingCash(getDb(), actor.employeeId)
  return { totalHalalas: rows.reduce((a, r) => a + r.amount, 0), payments: rows }
}

/**
 * The owner receives an employee's cash. Expected = all cash in custody; the actual amount is
 * counted; a difference needs a reason. Custody moves — revenue does not change (acceptance #15).
 */
export async function receiveHandover(actor: Actor, fromEmployeeId: string, actualHalalas: number, reason: string | null) {
  authorize(actor, 'cash.receive_handover')
  if (!Number.isSafeInteger(actualHalalas) || actualHalalas < 0) throw new ValidationError('validation_failed', { actual: 'amount_invalid' })
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'handover:' + fromEmployeeId}))`)
    const rows = await outstandingCash(tx, fromEmployeeId)
    if (rows.length === 0) throw new ValidationError('no_cash_in_custody')
    const expected = rows.reduce((a, r) => a + r.amount, 0)
    if (expected !== actualHalalas && !reason?.trim()) throw new ValidationError('validation_failed', { reason: 'difference_reason_required' })
    const [h] = await tx
      .insert(cashHandovers)
      .values({ fromEmployeeId, receivedByUserId: actor.userId, expectedHalalas: expected, actualHalalas, differenceReason: expected === actualHalalas ? null : reason!.trim() })
      .returning()
    await tx.update(payments).set({ cashHandoverId: h!.id }).where(inArray(payments.id, rows.map((r) => r.id)))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'cash.handover', entityType: 'employee', entityId: fromEmployeeId, after: { expected, actual: actualHalalas, difference: actualHalalas - expected }, reason })
    return h!
  })
}

export async function recentHandovers(actor: Actor, limit = 50) {
  authorize(actor, 'cash.receive_handover')
  return getDb()
    .select({ h: cashHandovers, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
    .from(cashHandovers)
    .innerJoin(employees, eq(employees.id, cashHandovers.fromEmployeeId))
    .orderBy(desc(cashHandovers.handedAt))
    .limit(limit)
}
