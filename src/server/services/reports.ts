import { and, notInArray, eq, gt, gte, inArray, lte, ne, sql } from 'drizzle-orm'
import { addDays, operationalDateOf, operationalDayBounds } from '@/domain/operational-day'
import { isMonthKey, monthFirstDay, monthInstants, monthLastDay, previousMonth } from '@/domain/months'
import { allocateOrderRevenue, growth } from '@/domain/revenue'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { getDb, type Executor } from '../db'
import {
  advances,
  commissionEntries,
  customers,
  employees,
  expenseCategories,
  expenses,
  orderLines,
  orders,
  packageSessions,
  payments,
  payrollAdjustments,
  payrollItems,
  payrollPayments,
  payrollRuns,
  visitItems,
  visits,
  visitSpecialists,
} from '../db/schema'
import { ValidationError } from './errors'
import { salariesOn } from './staff'
import { teamsOn } from './teams'

/**
 * Internal financial reports (spec §15–16). Every figure is computed from stored operations and
 * can be opened to the rows behind it. Test data (is_test) is always excluded.
 * Definitions (docs/DECISIONS.md D54–D58):
 * - Booked sales: value of orders confirmed in the period (by the operational day of confirmation).
 * - Executed revenue: visit allocations of visits completed in the period (by operational date).
 * - Collections: confirmed payments by their real received time.
 * - Deferred: money collected but not yet earned by executed visits.
 */

function range(from: string, to: string) {
  return { start: operationalDayBounds(from).startExclusive, end: operationalDayBounds(to).endInclusive }
}

async function bookedOrders(db: Executor, from: string, to: string) {
  const { start, end } = range(from, to)
  return db
    .select({ id: orders.id, reference: orders.reference, customerId: orders.customerId, customerName: customers.name, total: orders.grandTotalHalalas, services: orders.servicesTotalHalalas, moderatorId: orders.moderatorEmployeeId, confirmedAt: orders.confirmedAt })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(notInArray(orders.status, ['draft', 'cancelled']), eq(orders.isTest, false), eq(customers.isTest, false), gt(orders.confirmedAt, start), lte(orders.confirmedAt, end)))
}

/** Revenue allocation of all visits of the given orders. */
async function allocations(db: Executor, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, number>()
  const lines = await db.select().from(orderLines).where(inArray(orderLines.orderId, orderIds))
  const vs = await db.select().from(visits).where(inArray(visits.orderId, orderIds))
  const items = vs.length ? await db.select({ visitId: visitItems.visitId, lineId: visitItems.orderLineId }).from(visitItems).where(inArray(visitItems.visitId, vs.map((v) => v.id))) : []
  const sessions = lines.length ? await db.select().from(packageSessions).where(inArray(packageSessions.orderLineId, lines.map((l) => l.id))) : []
  const os = await db.select({ id: orders.id, fee: orders.deliveryFeeHalalas }).from(orders).where(inArray(orders.id, orderIds))
  const out = new Map<string, number>()
  for (const o of os) {
    const ol = lines.filter((l) => l.orderId === o.id)
    const first = vs.filter((v) => v.orderId === o.id).sort((a, b) => a.sequence - b.sequence)[0]
    const alloc = allocateOrderRevenue(
      ol.map((l) => ({
        final: l.finalPriceHalalas,
        visitIds:
          l.kind === 'package'
            ? sessions
                .filter((s) => s.orderLineId === l.id)
                .sort((a, b) => a.sessionNumber - b.sessionNumber)
                .map((s) => s.visitId)
            : [...new Set(items.filter((i) => i.lineId === l.id).map((i) => i.visitId))],
      })),
      o.fee,
      first?.id ?? null,
    )
    for (const [k, v] of alloc) out.set(k, v)
  }
  return out
}

async function executedVisits(db: Executor, from: string, to: string) {
  const rows = await db
    .select({ id: visits.id, orderId: visits.orderId, date: visits.operationalDate, reference: orders.reference, customerName: customers.name })
    .from(visits)
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(visits.status, 'completed'), eq(orders.isTest, false), gte(visits.operationalDate, from), lte(visits.operationalDate, to)))
  const alloc = await allocations(db, [...new Set(rows.map((r) => r.orderId))])
  return rows.map((r) => ({ ...r, revenue: alloc.get(r.id) ?? 0 }))
}

async function collectionsIn(db: Executor, start: Date, end: Date) {
  return db
    .select({ id: payments.id, orderId: payments.orderId, reference: orders.reference, method: payments.method, amount: payments.amountHalalas, receivedAt: payments.receivedAt, isDeposit: payments.isDeposit })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.status, 'confirmed'), eq(orders.isTest, false), gt(payments.receivedAt, start), lte(payments.receivedAt, end)))
}

/** Per order: collected vs executed up to a date → outstanding and deferred amounts. */
async function balancesAsOf(db: Executor, asOf: string) {
  const { endInclusive } = operationalDayBounds(asOf)
  const os = await db
    .select({ id: orders.id, reference: orders.reference, customerName: customers.name, total: orders.grandTotalHalalas })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(ne(orders.status, 'draft'), eq(orders.isTest, false), lte(orders.confirmedAt, endInclusive)))
  if (!os.length) return []
  const ids = os.map((o) => o.id)
  const paid = await db
    .select({ orderId: payments.orderId, sum: sql<number>`sum(${payments.amountHalalas})`.mapWith(Number) })
    .from(payments)
    .where(and(inArray(payments.orderId, ids), eq(payments.status, 'confirmed'), lte(payments.receivedAt, endInclusive)))
    .groupBy(payments.orderId)
  const done = await db.select({ id: visits.id, orderId: visits.orderId }).from(visits).where(and(inArray(visits.orderId, ids), eq(visits.status, 'completed'), lte(visits.operationalDate, asOf)))
  const alloc = await allocations(db, ids)
  return os.map((o) => {
    const collected = paid.find((p) => p.orderId === o.id)?.sum ?? 0
    const earned = done.filter((d) => d.orderId === o.id).reduce((a, d) => a + (alloc.get(d.id) ?? 0), 0)
    return { ...o, collected, earned, outstanding: Math.max(0, o.total - collected), deferred: Math.max(0, collected - earned) }
  })
}

// ─────────────────────────────── Dashboard ───────────────────────────────

async function snapshot(db: Executor, from: string, to: string) {
  const booked = await bookedOrders(db, from, to)
  const executed = await executedVisits(db, from, to)
  const { start, end } = range(from, to)
  const collected = await collectionsIn(db, start, end)
  return {
    booked: booked.reduce((a, o) => a + o.total, 0),
    bookings: booked.length,
    executed: executed.reduce((a, v) => a + v.revenue, 0),
    collected: collected.reduce((a, p) => a + p.amount, 0),
  }
}

/** Today vs previous operational day; month-to-date vs the same days of last month. */
export async function dashboardFigures(actor: Actor, now: Date = new Date()) {
  if (!can(actor, 'sales.read')) throw new ForbiddenError('sales.read')
  const db = getDb()
  const today = operationalDateOf(now)
  const yesterday = addDays(today, -1)
  const month = today.slice(0, 7)
  const monthStart = monthFirstDay(month)
  const prevMonth = previousMonth(month)
  const dayOfMonth = Number(today.slice(8, 10))
  const prevLast = monthLastDay(prevMonth)
  const prevSameDay = `${prevMonth}-${String(Math.min(dayOfMonth, Number(prevLast.slice(8, 10)))).padStart(2, '0')}`
  const [t, y, mtd, prev] = await Promise.all([snapshot(db, today, today), snapshot(db, yesterday, yesterday), snapshot(db, monthStart, today), snapshot(db, monthFirstDay(prevMonth), prevSameDay)])
  const withGrowth = (cur: Awaited<ReturnType<typeof snapshot>>, base: Awaited<ReturnType<typeof snapshot>>) => ({
    ...cur,
    growth: { booked: growth(cur.booked, base.booked), executed: growth(cur.executed, base.executed), collected: growth(cur.collected, base.collected), bookings: growth(cur.bookings, base.bookings) },
    previous: base,
  })
  const finance = can(actor, 'finance.company.read')
  const strip = (s: ReturnType<typeof withGrowth>) => (finance ? s : { booked: s.booked, bookings: s.bookings, growth: { booked: s.growth.booked, bookings: s.growth.bookings }, previous: { booked: s.previous.booked, bookings: s.previous.bookings } })
  return { today, month, day: strip(withGrowth(t, y)), monthToDate: strip(withGrowth(mtd, prev)), finance }
}

// ─────────────────────────────── Monthly report ───────────────────────────────

export async function monthlyReport(actor: Actor, month: string) {
  if (!isMonthKey(month)) throw new ValidationError('validation_failed', { month: 'invalid' })
  if (!can(actor, 'sales.read')) throw new ForbiddenError('sales.read')
  const finance = can(actor, 'finance.company.read')
  const db = getDb()
  const from = monthFirstDay(month)
  const to = monthLastDay(month)
  const booked = await bookedOrders(db, from, to)

  // Customers: first confirmed order ever within this month → new.
  const custIds = [...new Set(booked.map((o) => o.customerId))]
  const firsts = custIds.length
    ? await db
        .select({ customerId: orders.customerId, first: sql<Date>`min(${orders.confirmedAt})`.mapWith((v) => new Date(v as string)) })
        .from(orders)
        .where(and(inArray(orders.customerId, custIds), notInArray(orders.status, ['draft', 'cancelled'])))
        .groupBy(orders.customerId)
    : []
  const { start: monthStart } = range(from, to)
  const newCustomers = firsts.filter((f) => f.first > monthStart).length

  // Top services and packages sold in the month.
  const ids = booked.map((o) => o.id)
  const lineRows = ids.length ? await db.select({ kind: orderLines.kind, nameAr: orderLines.nameAr, nameEn: orderLines.nameEn, final: orderLines.finalPriceHalalas }).from(orderLines).where(inArray(orderLines.orderId, ids)) : []
  const top = new Map<string, { nameAr: string; nameEn: string; kind: string; count: number; value: number }>()
  for (const l of lineRows) {
    const k = `${l.kind}:${l.nameAr}`
    const e = top.get(k) ?? { nameAr: l.nameAr, nameEn: l.nameEn, kind: l.kind, count: 0, value: 0 }
    e.count++
    e.value += l.final
    top.set(k, e)
  }

  // By moderator (booked).
  const empRows = await db.select({ id: employees.id, fullName: employees.fullName, displayNameEn: employees.displayNameEn, role: employees.role }).from(employees)
  const nameOf = (id: string | null) => {
    const e = empRows.find((x) => x.id === id)
    return e ? (actor.locale === 'en' && e.displayNameEn ? e.displayNameEn : e.fullName) : null
  }
  const byModerator = new Map<string, { name: string; orders: number; value: number }>()
  for (const o of booked) {
    const key = o.moderatorId ?? '-'
    const e = byModerator.get(key) ?? { name: nameOf(o.moderatorId) ?? '—', orders: 0, value: 0 }
    e.orders++
    e.value += o.total
    byModerator.set(key, e)
  }

  const sales = {
    bookedValue: booked.reduce((a, o) => a + o.total, 0),
    bookings: booked.length,
    averageOrder: booked.length ? Math.round(booked.reduce((a, o) => a + o.total, 0) / booked.length) : 0,
    newCustomers,
    returningCustomers: custIds.length - newCustomers,
    topItems: [...top.values()].sort((a, b) => b.count - a.count || b.value - a.value).slice(0, 10),
    byModerator: [...byModerator.values()].sort((a, b) => b.value - a.value),
  }
  if (!finance) return { month, finance: false as const, sales }

  // Finance.
  const executed = await executedVisits(db, from, to)
  const executedRevenue = executed.reduce((a, v) => a + v.revenue, 0)
  const { start, end } = monthInstants(month)
  const collected = await collectionsIn(db, range(from, to).start, range(from, to).end)
  const byMethod: Record<string, number> = {}
  for (const p of collected) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount
  const balances = await balancesAsOf(db, to)

  // Performance by specialist and team (executed visits; revenue split equally among the visit's specialists).
  const specRows = executed.length ? await db.select().from(visitSpecialists).where(inArray(visitSpecialists.visitId, executed.map((v) => v.id))) : []
  const bySpecialist = new Map<string, { name: string; visits: number; revenue: number }>()
  const byTeam = new Map<string, { teamId: string; visits: number; revenue: number }>()
  for (const v of executed) {
    const ss = specRows.filter((s) => s.visitId === v.id)
    const share = ss.length ? Math.floor(v.revenue / ss.length) : 0
    const teamMap = await teamsOn(db, ss.map((s) => s.employeeId), v.date!)
    for (const [i, s] of ss.entries()) {
      const part = share + (i === 0 ? v.revenue - share * ss.length : 0)
      const e = bySpecialist.get(s.employeeId) ?? { name: nameOf(s.employeeId) ?? '', visits: 0, revenue: 0 }
      e.visits++
      e.revenue += part
      bySpecialist.set(s.employeeId, e)
      const teamId = teamMap.get(s.employeeId) ?? '-'
      const te = byTeam.get(teamId) ?? { teamId, visits: 0, revenue: 0 }
      te.visits++
      te.revenue += part
      byTeam.set(teamId, te)
    }
  }

  // Expenses of the period (accrual).
  const exp = await db
    .select({ amount: expenses.amountHalalas, categoryCode: expenseCategories.code, nameAr: expenseCategories.nameAr, nameEn: expenseCategories.nameEn })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(eq(expenses.periodMonth, month), eq(expenses.status, 'approved'), eq(expenses.isTest, false)))
  const byCategory = new Map<string, { code: string; nameAr: string; nameEn: string; amount: number }>()
  for (const e of exp) {
    const c = byCategory.get(e.categoryCode) ?? { code: e.categoryCode, nameAr: e.nameAr, nameEn: e.nameEn, amount: 0 }
    c.amount += e.amount
    byCategory.set(e.categoryCode, c)
  }
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.month, month))
  let salaries: number
  let salariesEstimated = false
  if (run && run.status !== 'draft') {
    const items = await db.select({ base: payrollItems.baseSalaryHalalas }).from(payrollItems).where(eq(payrollItems.runId, run.id))
    salaries = items.reduce((a, i) => a + i.base, 0)
  } else {
    const active = await db.select({ id: employees.id }).from(employees).where(and(ne(employees.status, 'archived'), eq(employees.isTest, false)))
    salaries = [...(await salariesOn(db, active.map((e) => e.id), to)).values()].reduce((a, b) => a + b, 0)
    salariesEstimated = true
  }
  const commissions = (
    await db
      .select({ sum: sql<number>`coalesce(sum(${commissionEntries.amountHalalas}), 0)`.mapWith(Number) })
      .from(commissionEntries)
      .where(and(gte(commissionEntries.earnedAt, start), sql`${commissionEntries.earnedAt} < ${end}`))
  )[0]!.sum
  const adj = await db.select().from(payrollAdjustments).where(eq(payrollAdjustments.month, month))
  const bonuses = adj.filter((a) => a.kind === 'bonus').reduce((a, x) => a + x.amountHalalas, 0)
  const deductions = adj.filter((a) => a.kind === 'deduction').reduce((a, x) => a + x.amountHalalas, 0)
  const otherExpenses = [...byCategory.values()].reduce((a, c) => a + c.amount, 0)
  const totalExpenses = otherExpenses + salaries + commissions + bonuses - deductions

  // Cash flow of the month: money in − money actually paid out (expense payments, salaries, advances).
  const paidExpenses = (
    await db
      .select({ sum: sql<number>`coalesce(sum(${expenses.amountHalalas}), 0)`.mapWith(Number) })
      .from(expenses)
      .where(and(eq(expenses.status, 'approved'), eq(expenses.isTest, false), gte(expenses.paidOn, from), lte(expenses.paidOn, to)))
  )[0]!.sum
  const paidPayroll = (
    await db
      .select({ sum: sql<number>`coalesce(sum(${payrollPayments.amountHalalas}), 0)`.mapWith(Number) })
      .from(payrollPayments)
      .where(and(gte(payrollPayments.paidOn, from), lte(payrollPayments.paidOn, to)))
  )[0]!.sum
  const advancesGiven = (
    await db
      .select({ sum: sql<number>`coalesce(sum(${advances.amountHalalas}), 0)`.mapWith(Number) })
      .from(advances)
      .where(and(gte(advances.givenOn, from), lte(advances.givenOn, to)))
  )[0]!.sum
  const collectedTotal = collected.reduce((a, p) => a + p.amount, 0)

  return {
    month,
    finance: true as const,
    sales,
    executedRevenue,
    collections: { total: collectedTotal, byMethod, deposits: collected.filter((p) => p.isDeposit).reduce((a, p) => a + p.amount, 0) },
    outstanding: balances.reduce((a, b) => a + b.outstanding, 0),
    deferred: balances.reduce((a, b) => a + b.deferred, 0),
    gateways: null, // Tabby/Tamara settlements and fees: phase 5.
    expenses: { byCategory: [...byCategory.values()], salaries, salariesEstimated, commissions, bonuses, deductions, total: totalExpenses },
    operatingResult: executedRevenue - totalExpenses,
    cashFlow: { in: collectedTotal, out: paidExpenses + paidPayroll + advancesGiven, paidExpenses, paidPayroll, advancesGiven, net: collectedTotal - paidExpenses - paidPayroll - advancesGiven },
    bySpecialist: [...bySpecialist.values()].sort((a, b) => b.revenue - a.revenue),
    byTeam: [...byTeam.values()],
  }
}

// ─────────────────────────────── Drill-down & export ───────────────────────────────

export const METRICS = ['booked', 'executed', 'collections', 'outstanding', 'deferred', 'expenses', 'commissions'] as const
export type Metric = (typeof METRICS)[number]

const SALES_METRICS: readonly Metric[] = ['booked']

/** Rows behind a figure, so every number can be reconciled with the original operations. */
export async function metricRows(actor: Actor, metric: Metric, month: string) {
  if (!isMonthKey(month) || !METRICS.includes(metric)) throw new ValidationError('validation_failed', { metric: 'invalid' })
  if (!can(actor, 'sales.read')) throw new ForbiddenError('sales.read')
  if (!SALES_METRICS.includes(metric) && !can(actor, 'finance.company.read')) throw new ForbiddenError('finance.company.read')
  const db = getDb()
  const from = monthFirstDay(month)
  const to = monthLastDay(month)
  switch (metric) {
    case 'booked':
      return (await bookedOrders(db, from, to)).map((o) => ({ reference: o.reference, customer: o.customerName, date: o.confirmedAt ? operationalDateOf(o.confirmedAt) : '', amount: o.total, orderId: o.id }))
    case 'executed':
      return (await executedVisits(db, from, to)).map((v) => ({ reference: v.reference, customer: v.customerName, date: v.date ?? '', amount: v.revenue, orderId: v.orderId }))
    case 'collections': {
      const { start, end } = range(from, to)
      return (await collectionsIn(db, start, end)).map((p) => ({ reference: p.reference, method: p.method, date: operationalDateOf(p.receivedAt), amount: p.amount, orderId: p.orderId }))
    }
    case 'outstanding':
      return (await balancesAsOf(db, to)).filter((b) => b.outstanding > 0).map((b) => ({ reference: b.reference, customer: b.customerName, total: b.total, collected: b.collected, amount: b.outstanding, orderId: b.id }))
    case 'deferred':
      return (await balancesAsOf(db, to)).filter((b) => b.deferred > 0).map((b) => ({ reference: b.reference, customer: b.customerName, collected: b.collected, earned: b.earned, amount: b.deferred, orderId: b.id }))
    case 'expenses':
      return (
        await db
          .select({ date: expenses.paidOn, description: expenses.description, category: actor.locale === 'en' ? expenseCategories.nameEn : expenseCategories.nameAr, amount: expenses.amountHalalas })
          .from(expenses)
          .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
          .where(and(eq(expenses.periodMonth, month), eq(expenses.status, 'approved'), eq(expenses.isTest, false)))
      ).map((e) => ({ ...e, date: e.date ?? '' }))
    case 'commissions': {
      const { start, end } = monthInstants(month)
      return (
        await db
          .select({ employee: employees.fullName, kind: commissionEntries.kind, reference: orders.reference, amount: commissionEntries.amountHalalas, earnedAt: commissionEntries.earnedAt })
          .from(commissionEntries)
          .innerJoin(employees, eq(employees.id, commissionEntries.employeeId))
          .leftJoin(orders, eq(orders.id, commissionEntries.orderId))
          .where(and(gte(commissionEntries.earnedAt, start), sql`${commissionEntries.earnedAt} < ${end}`))
      ).map((c) => ({ employee: c.employee, kind: c.kind, reference: c.reference ?? '', date: operationalDateOf(c.earnedAt), amount: c.amount }))
    }
  }
}

/** CSV for Excel: UTF-8 with BOM (Arabic displays correctly), SAR with 2 decimals. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '﻿'
  const cols = Object.keys(rows[0]!).filter((c) => c !== 'orderId')
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const fmt = (c: string, v: unknown) => (typeof v === 'number' && /amount|total|collected|earned/i.test(c) ? (v / 100).toFixed(2) : v)
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(fmt(c, r[c]))).join(','))].join('\r\n')
}

export function assertCanExport(actor: Actor, metric: Metric) {
  authorize(actor, SALES_METRICS.includes(metric) ? 'sales.read' : 'reports.export')
}
