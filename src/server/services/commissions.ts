import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { COMMISSION_RULES_V1, moderatorCommission, specialistCommissions, type CommissionRules, type CommissionUnit } from '@/domain/commission'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { commissionEntries, employees, orderLines, orders, packageSessions, payments, visitItems, visits, visitSpecialists } from '../db/schema'
import { ValidationError } from './errors'

/** Confirmed / pending totals of an order. */
export async function orderBalance(db: Executor, orderId: string) {
  const [o] = await db.select({ total: orders.grandTotalHalalas }).from(orders).where(eq(orders.id, orderId))
  const rows = await db
    .select({ status: payments.status, sum: sql<number>`coalesce(sum(${payments.amountHalalas}), 0)`.mapWith(Number) })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .groupBy(payments.status)
  const confirmed = rows.find((r) => r.status === 'confirmed')?.sum ?? 0
  const pending = rows.find((r) => r.status === 'pending')?.sum ?? 0
  const total = o?.total ?? 0
  return { total, confirmed, pending, remaining: total - confirmed, fullyPaid: total > 0 ? confirmed >= total : confirmed >= 0 }
}

/** Commission units of an order, from what is stored (who did what, what was executed). */
export async function commissionUnits(db: Executor, orderId: string): Promise<{ units: CommissionUnit[]; allExecuted: boolean }> {
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId))
  const vs = await db.select().from(visits).where(eq(visits.orderId, orderId))
  const done = new Set(vs.filter((v) => v.status === 'completed').map((v) => v.id))
  const ids = vs.map((v) => v.id)
  const items = ids.length ? await db.select().from(visitItems).where(inArray(visitItems.visitId, ids)) : []
  const specs = ids.length ? await db.select().from(visitSpecialists).where(inArray(visitSpecialists.visitId, ids)) : []
  const sessions = lines.length ? await db.select().from(packageSessions).where(inArray(packageSessions.orderLineId, lines.map((l) => l.id))) : []
  const units: CommissionUnit[] = lines.map((l) => {
    if (l.kind === 'package') {
      return {
        kind: 'package',
        id: l.id,
        visits: sessions
          .filter((s) => s.orderLineId === l.id)
          .sort((a, b) => a.sessionNumber - b.sessionNumber)
          .map((s) => ({ visitId: s.visitId, specialistIds: specs.filter((x) => x.visitId === s.visitId).map((x) => x.employeeId), executed: done.has(s.visitId) })),
      }
    }
    const item = items.find((i) => i.orderLineId === l.id)
    return { kind: 'service', id: l.id, specialistId: item?.specialistEmployeeId ?? null, executed: item ? done.has(item.visitId) : false }
  })
  return { units, allExecuted: vs.length > 0 && vs.every((v) => v.status === 'completed') }
}

/**
 * Bring the ledger in line with what is due now. Runs under a lock on the order so repeated
 * taps, retries or duplicate webhooks can never add a commission twice (only the delta is added).
 */
export async function syncCommissions(tx: Executor, orderId: string): Promise<void> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
  if (!o || o.status === 'draft' || o.isTest) return
  const rules = (o.commissionRules as CommissionRules | null) ?? COMMISSION_RULES_V1
  const balance = await orderBalance(tx, orderId)
  const { units, allExecuted } = await commissionUnits(tx, orderId)
  const existing = await tx
    .select({ employeeId: commissionEntries.employeeId, kind: commissionEntries.kind, sum: sql<number>`sum(${commissionEntries.amountHalalas})`.mapWith(Number) })
    .from(commissionEntries)
    .where(and(eq(commissionEntries.orderId, orderId), inArray(commissionEntries.kind, ['specialist', 'moderator'])))
    .groupBy(commissionEntries.employeeId, commissionEntries.kind)

  for (const s of specialistCommissions(units, { orderFullyPaid: balance.fullyPaid }, rules)) {
    const already = existing.find((e) => e.kind === 'specialist' && e.employeeId === s.specialistId)?.sum ?? 0
    const delta = s.earned - already
    if (delta > 0) {
      await tx.insert(commissionEntries).values({ orderId, employeeId: s.specialistId, kind: 'specialist', amountHalalas: delta, rulesVersion: rules.version })
    }
  }

  // Moderator: once per original order, when fully executed and fully paid.
  const moderatorPaid = existing.filter((e) => e.kind === 'moderator').reduce((a, e) => a + e.sum, 0)
  if (allExecuted && balance.fullyPaid && moderatorPaid === 0 && o.moderatorEmployeeId) {
    const [m] = await tx.select({ role: employees.role }).from(employees).where(eq(employees.id, o.moderatorEmployeeId))
    const amount = moderatorCommission(o.servicesTotalHalalas, rules)
    if (m?.role === 'moderator' && amount > 0) {
      await tx.insert(commissionEntries).values({ orderId, employeeId: o.moderatorEmployeeId, kind: 'moderator', amountHalalas: amount, rulesVersion: rules.version })
    }
  }
}

export interface CommissionSummary {
  employeeId: string
  expected: number
  earnedUnpaid: number
  paid: number
}

async function summarize(db: Executor, employeeIds: string[]): Promise<CommissionSummary[]> {
  if (!employeeIds.length) return []
  const ledger = await db
    .select({ employeeId: commissionEntries.employeeId, settled: sql<boolean>`${commissionEntries.payrollItemId} IS NOT NULL`, sum: sql<number>`sum(${commissionEntries.amountHalalas})`.mapWith(Number) })
    .from(commissionEntries)
    .where(inArray(commissionEntries.employeeId, employeeIds))
    .groupBy(commissionEntries.employeeId, sql`${commissionEntries.payrollItemId} IS NOT NULL`)

  // Expected = what open orders will pay once executed and paid, minus what is already earned.
  const openOrders = await db
    .select({ id: orders.id, moderator: orders.moderatorEmployeeId, services: orders.servicesTotalHalalas, rules: orders.commissionRules })
    .from(orders)
    .where(and(inArray(orders.status, ['confirmed', 'pending_review']), eq(orders.isTest, false)))
  const expected = new Map<string, number>()
  for (const o of openOrders) {
    const rules = (o.rules as CommissionRules | null) ?? COMMISSION_RULES_V1
    const { units } = await commissionUnits(db, o.id)
    const earned = await db
      .select({ employeeId: commissionEntries.employeeId, sum: sql<number>`sum(${commissionEntries.amountHalalas})`.mapWith(Number) })
      .from(commissionEntries)
      .where(eq(commissionEntries.orderId, o.id))
      .groupBy(commissionEntries.employeeId)
    for (const s of specialistCommissions(units, { orderFullyPaid: false }, rules)) {
      if (!employeeIds.includes(s.specialistId)) continue
      const e = earned.find((x) => x.employeeId === s.specialistId)?.sum ?? 0
      expected.set(s.specialistId, (expected.get(s.specialistId) ?? 0) + Math.max(0, s.expected - e))
    }
    if (o.moderator && employeeIds.includes(o.moderator)) {
      const e = earned.find((x) => x.employeeId === o.moderator)?.sum ?? 0
      if (e === 0) expected.set(o.moderator, (expected.get(o.moderator) ?? 0) + moderatorCommission(o.services, rules))
    }
  }
  return employeeIds.map((id) => ({
    employeeId: id,
    expected: expected.get(id) ?? 0,
    earnedUnpaid: ledger.filter((l) => l.employeeId === id && !l.settled).reduce((a, l) => a + l.sum, 0),
    paid: ledger.filter((l) => l.employeeId === id && l.settled).reduce((a, l) => a + l.sum, 0),
  }))
}

/** Own commissions only (acceptance #3). Moderator's expected excludes non-moderator roles. */
export async function myCommissions(actor: Actor) {
  authorize(actor, 'commissions.read.own')
  const db = getDb()
  const [summary] = await summarize(db, [actor.employeeId])
  const entries = await db
    .select({ id: commissionEntries.id, orderId: commissionEntries.orderId, reference: orders.reference, kind: commissionEntries.kind, amount: commissionEntries.amountHalalas, earnedAt: commissionEntries.earnedAt, reason: commissionEntries.reason, settled: sql<boolean>`${commissionEntries.payrollItemId} IS NOT NULL` })
    .from(commissionEntries)
    .leftJoin(orders, eq(orders.id, commissionEntries.orderId))
    .where(eq(commissionEntries.employeeId, actor.employeeId))
    .orderBy(sql`${commissionEntries.earnedAt} desc`)
    .limit(200)
  return { summary: summary!, entries }
}

export async function allCommissions(actor: Actor) {
  authorize(actor, 'commissions.read.all')
  const db = getDb()
  const staff = await db.select({ id: employees.id, fullName: employees.fullName, displayNameEn: employees.displayNameEn, role: employees.role }).from(employees).where(inArray(employees.role, ['specialist', 'moderator']))
  const sums = await summarize(db, staff.map((s) => s.id))
  return staff.map((s) => ({ ...s, name: actor.locale === 'en' && s.displayNameEn ? s.displayNameEn : s.fullName, ...sums.find((x) => x.employeeId === s.id)! }))
}

/** Manual correction with a reason; never edits an existing (possibly paid) entry. */
export async function adjustCommission(actor: Actor, employeeId: string, orderId: string | null, amountHalalas: number, reason: string) {
  authorize(actor, 'commissions.adjust')
  if (!Number.isSafeInteger(amountHalalas) || amountHalalas === 0) throw new ValidationError('validation_failed', { amount: 'amount_invalid' })
  if (!reason?.trim()) throw new ValidationError('validation_failed', { reason: 'required' })
  await getDb().transaction(async (tx) => {
    const [row] = await tx.insert(commissionEntries).values({ orderId, employeeId, kind: 'adjustment', amountHalalas, reason: reason.trim(), createdByUserId: actor.userId }).returning()
    await writeAudit(tx, { actorUserId: actor.userId, action: 'commission.adjust', entityType: 'employee', entityId: employeeId, after: { amountHalalas, orderId, entry: row!.id }, reason: reason.trim() })
  })
}

/** Unsettled entries of an employee up to a date (used by payroll). */
export async function unsettledCommissions(db: Executor, employeeId: string, until: Date) {
  return db
    .select()
    .from(commissionEntries)
    .where(and(eq(commissionEntries.employeeId, employeeId), isNull(commissionEntries.payrollItemId), sql`${commissionEntries.earnedAt} < ${until}`))
}

export function assertCanSeeCommissionsOf(actor: Actor, employeeId: string) {
  if (employeeId !== actor.employeeId && !can(actor, 'commissions.read.all')) throw new ForbiddenError('commissions.read.all')
}
