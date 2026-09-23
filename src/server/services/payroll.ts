import { and, asc, eq, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { isMonthKey, monthInstants, monthLastDay, nextMonth } from '@/domain/months'
import { riyadhToday } from '@/domain/operational-day'
import { authorize, type Actor } from '../authz/actor'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { advanceRepayments, advances, commissionEntries, employees, payrollAdjustments, payrollItems, payrollPayments, payrollRuns } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'
import { salariesOn } from './staff'
import { parseWith } from './validation'

function checkMonth(month: string) {
  if (!isMonthKey(month)) throw new ValidationError('validation_failed', { month: 'invalid' })
}

// ─────────────────────────────── Advances ───────────────────────────────

export async function advanceBalances(db: Executor, employeeIds?: string[]) {
  const list = await db
    .select()
    .from(advances)
    .where(employeeIds?.length ? inArray(advances.employeeId, employeeIds) : undefined)
    .orderBy(asc(advances.givenOn))
  if (!list.length) return []
  const repaid = await db
    .select({ advanceId: advanceRepayments.advanceId, sum: sql<number>`sum(${advanceRepayments.amountHalalas})`.mapWith(Number) })
    .from(advanceRepayments)
    .where(inArray(advanceRepayments.advanceId, list.map((a) => a.id)))
    .groupBy(advanceRepayments.advanceId)
  const byId = new Map(repaid.map((r) => [r.advanceId, r.sum]))
  return list.map((a) => ({ ...a, repaidHalalas: byId.get(a.id) ?? 0, outstandingHalalas: a.amountHalalas - (byId.get(a.id) ?? 0) }))
}

/** A salary advance: a receivable repaid by payroll deductions, never an extra salary expense. */
export async function createAdvance(actor: Actor, raw: unknown) {
  authorize(actor, 'payroll.manage')
  const d = parseWith(
    z.object({
      employeeId: z.uuid(),
      amountHalalas: z.number().int().min(1).max(100_000_000),
      monthlyInstallmentHalalas: z.number().int().min(1),
      givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z
        .string()
        .trim()
        .max(500)
        .optional()
        .nullable()
        .transform((v) => v || null),
    }),
    raw,
  )
  if (d.monthlyInstallmentHalalas > d.amountHalalas) throw new ValidationError('validation_failed', { monthlyInstallmentHalalas: 'installment_too_high' })
  return getDb().transaction(async (tx) => {
    const [a] = await tx
      .insert(advances)
      .values({ ...d, createdByUserId: actor.userId })
      .returning()
    await writeAudit(tx, { actorUserId: actor.userId, action: 'advance.create', entityType: 'employee', entityId: d.employeeId, after: { amountHalalas: d.amountHalalas, installment: d.monthlyInstallmentHalalas }, reason: d.reason })
    return a!
  })
}

// ─────────────────────────────── Adjustments ───────────────────────────────

/** Documented bonus/deduction. Months already approved cannot change: use the next month. */
export async function addPayrollAdjustment(actor: Actor, raw: unknown) {
  authorize(actor, 'payroll.manage')
  const d = parseWith(
    z.object({ month: z.string().refine(isMonthKey), employeeId: z.uuid(), kind: z.enum(['bonus', 'deduction']), amountHalalas: z.number().int().min(1).max(100_000_000), reason: z.string().trim().min(1).max(500) }),
    raw,
  )
  await getDb().transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, d.month)).for('update')
    if (run && run.status !== 'draft') throw new ValidationError('payroll_month_locked', { next: nextMonth(d.month) })
    const [row] = await tx
      .insert(payrollAdjustments)
      .values({ ...d, createdByUserId: actor.userId })
      .returning()
    await writeAudit(tx, { actorUserId: actor.userId, action: 'payroll.adjustment', entityType: 'employee', entityId: d.employeeId, after: { month: d.month, kind: d.kind, amountHalalas: d.amountHalalas, id: row!.id }, reason: d.reason })
    if (run) await buildItems(tx, run.id, d.month)
  })
}

// ─────────────────────────────── Runs ───────────────────────────────

interface Computed {
  employeeId: string
  base: number
  commissions: number
  commissionIds: string[]
  bonuses: number
  deductions: number
  advanceParts: { advanceId: string; amount: number }[]
  advanceDeduction: number
  net: number
}

async function compute(db: Executor, month: string): Promise<Computed[]> {
  const { end } = monthInstants(month)
  const lastDay = monthLastDay(month)
  const emps = await db.select().from(employees).where(ne(employees.status, 'archived'))
  const ids = emps.map((e) => e.id)
  const salaries = await salariesOn(db, ids, lastDay)
  const comm = await db
    .select({ id: commissionEntries.id, employeeId: commissionEntries.employeeId, amount: commissionEntries.amountHalalas })
    .from(commissionEntries)
    .where(and(isNull(commissionEntries.payrollItemId), lt(commissionEntries.earnedAt, end)))
  const adj = await db.select().from(payrollAdjustments).where(eq(payrollAdjustments.month, month))
  const adv = (await advanceBalances(db)).filter((a) => a.outstandingHalalas > 0 && a.givenOn <= lastDay)

  const out: Computed[] = []
  for (const e of emps) {
    const base = salaries.get(e.id) ?? 0
    const myComm = comm.filter((c) => c.employeeId === e.id)
    const commissions = myComm.reduce((a, c) => a + c.amount, 0)
    const bonuses = adj.filter((a) => a.employeeId === e.id && a.kind === 'bonus').reduce((a, x) => a + x.amountHalalas, 0)
    const deductions = adj.filter((a) => a.employeeId === e.id && a.kind === 'deduction').reduce((a, x) => a + x.amountHalalas, 0)
    let available = base + commissions + bonuses - deductions
    const advanceParts: { advanceId: string; amount: number }[] = []
    for (const a of adv.filter((x) => x.employeeId === e.id)) {
      const amount = Math.max(0, Math.min(a.monthlyInstallmentHalalas, a.outstandingHalalas, available))
      if (amount > 0) {
        advanceParts.push({ advanceId: a.id, amount })
        available -= amount
      }
    }
    const advanceDeduction = advanceParts.reduce((a, p) => a + p.amount, 0)
    if (base === 0 && commissions === 0 && bonuses === 0 && deductions === 0 && advanceDeduction === 0) continue
    out.push({ employeeId: e.id, base, commissions, commissionIds: myComm.map((c) => c.id), bonuses, deductions, advanceParts, advanceDeduction, net: base + commissions + bonuses - deductions - advanceDeduction })
  }
  return out
}

async function buildItems(tx: Executor, runId: string, month: string): Promise<Computed[]> {
  await tx.delete(payrollItems).where(eq(payrollItems.runId, runId))
  const rows = await compute(tx, month)
  for (const r of rows) {
    await tx.insert(payrollItems).values({
      runId,
      employeeId: r.employeeId,
      baseSalaryHalalas: r.base,
      commissionsHalalas: r.commissions,
      bonusesHalalas: r.bonuses,
      deductionsHalalas: r.deductions,
      advanceDeductionHalalas: r.advanceDeduction,
      netHalalas: r.net,
    })
  }
  return rows
}

/** Create or refresh the month's DRAFT payroll (preview; nothing is settled yet). */
export async function prepareRun(actor: Actor, month: string) {
  authorize(actor, 'payroll.manage')
  checkMonth(month)
  return getDb().transaction(async (tx) => {
    await tx.insert(payrollRuns).values({ month, createdByUserId: actor.userId }).onConflictDoNothing()
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, month)).for('update')
    if (run!.status === 'draft') await buildItems(tx, run!.id, month)
    return run!
  })
}

/**
 * Approve after the month has ended: freeze items, settle the included commission entries
 * (so they are never paid twice) and record advance installments.
 */
export async function approveRun(actor: Actor, month: string) {
  authorize(actor, 'payroll.manage')
  checkMonth(month)
  if (riyadhToday() <= monthLastDay(month)) throw new ValidationError('payroll_month_not_ended')
  await getDb().transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, month)).for('update')
    if (!run) throw new NotFoundError()
    if (run.status !== 'draft') return
    const rows = await buildItems(tx, run.id, month)
    const items = await tx.select().from(payrollItems).where(eq(payrollItems.runId, run.id))
    for (const r of rows) {
      const item = items.find((i) => i.employeeId === r.employeeId)!
      if (r.commissionIds.length) await tx.update(commissionEntries).set({ payrollItemId: item.id }).where(inArray(commissionEntries.id, r.commissionIds))
      for (const p of r.advanceParts) await tx.insert(advanceRepayments).values({ advanceId: p.advanceId, payrollItemId: item.id, amountHalalas: p.amount })
    }
    await tx.update(payrollRuns).set({ status: 'approved', approvedByUserId: actor.userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(payrollRuns.id, run.id))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'payroll.approve', entityType: 'payroll', entityId: month, after: { employees: rows.length, net: rows.reduce((a, r) => a + r.net, 0) } })
  })
}

async function paidOf(db: Executor, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, number>()
  const rows = await db
    .select({ itemId: payrollPayments.payrollItemId, sum: sql<number>`sum(${payrollPayments.amountHalalas})`.mapWith(Number) })
    .from(payrollPayments)
    .where(inArray(payrollPayments.payrollItemId, itemIds))
    .groupBy(payrollPayments.payrollItemId)
  return new Map(rows.map((r) => [r.itemId, r.sum]))
}

/** Actual salary payment (cash flow). Cannot exceed the approved net. */
export async function recordPayrollPayment(actor: Actor, itemId: string, raw: unknown) {
  authorize(actor, 'payroll.manage')
  const d = parseWith(
    z.object({
      amountHalalas: z.number().int().min(1),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      method: z.enum(['cash', 'bank_transfer']),
      reference: z
        .string()
        .trim()
        .max(200)
        .optional()
        .nullable()
        .transform((v) => v || null),
    }),
    raw,
  )
  await getDb().transaction(async (tx) => {
    const [item] = await tx.select().from(payrollItems).where(eq(payrollItems.id, itemId))
    if (!item) throw new NotFoundError()
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, item.runId)).for('update')
    if (run!.status !== 'approved') throw new ValidationError('payroll_not_approved')
    const paid = (await paidOf(tx, [itemId])).get(itemId) ?? 0
    if (paid + d.amountHalalas > item.netHalalas) throw new ValidationError('validation_failed', { amountHalalas: 'payroll_overpaid' })
    await tx.insert(payrollPayments).values({ payrollItemId: itemId, ...d, createdByUserId: actor.userId })
    await writeAudit(tx, { actorUserId: actor.userId, action: 'payroll.payment', entityType: 'employee', entityId: item.employeeId, after: { month: run!.month, amountHalalas: d.amountHalalas, paidOn: d.paidOn } })
  })
}

/** Close the month once everything is paid. Later corrections go to a following month. */
export async function closeRun(actor: Actor, month: string) {
  authorize(actor, 'payroll.manage')
  await getDb().transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, month)).for('update')
    if (!run) throw new NotFoundError()
    if (run.status !== 'approved') throw new ValidationError('payroll_not_approved')
    const items = await tx.select().from(payrollItems).where(eq(payrollItems.runId, run.id))
    const paid = await paidOf(tx, items.map((i) => i.id))
    if (items.some((i) => (paid.get(i.id) ?? 0) < i.netHalalas)) throw new ValidationError('payroll_unpaid')
    await tx.update(payrollRuns).set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() }).where(eq(payrollRuns.id, run.id))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'payroll.close', entityType: 'payroll', entityId: month })
  })
}

export async function getRun(actor: Actor, month: string) {
  authorize(actor, 'payroll.manage')
  checkMonth(month)
  const db = getDb()
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.month, month))
  if (!run) return null
  const items = await db
    .select({ i: payrollItems, fullName: employees.fullName, displayNameEn: employees.displayNameEn, role: employees.role })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, run.id))
  const paid = await paidOf(db, items.map((x) => x.i.id))
  const adjustments = await db.select().from(payrollAdjustments).where(eq(payrollAdjustments.month, month))
  return {
    run,
    items: items.map((x) => ({
      ...x.i,
      name: actor.locale === 'en' && x.displayNameEn ? x.displayNameEn : x.fullName,
      role: x.role,
      paidHalalas: paid.get(x.i.id) ?? 0,
      remainingHalalas: x.i.netHalalas - (paid.get(x.i.id) ?? 0),
    })),
    adjustments,
  }
}

/** Months up to a date whose salary structure is frozen (approved/closed). */
export async function lockedMonths(db: Executor, until: string) {
  return (await db.select({ month: payrollRuns.month }).from(payrollRuns).where(and(ne(payrollRuns.status, 'draft'), lte(payrollRuns.month, until)))).map((r) => r.month)
}
