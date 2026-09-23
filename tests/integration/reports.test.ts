import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GET as exportCsv } from '@/app/api/reports/export/route'
import { GET as monthlyApi } from '@/app/api/reports/monthly/route'
import { addDays } from '@/domain/operational-day'
import { currentMonth, monthFirstDay, nextMonth } from '@/domain/months'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { expenseCategories, orders } from '@/server/db/schema'
import { createExpense } from '@/server/services/expenses'
import { completeVisit, getOrderDetail, saveOrder } from '@/server/services/orders'
import { recordPayment } from '@/server/services/payments'
import { metricRows, monthlyReport, toCsv } from '@/server/services/reports'
import { createEmployee } from '@/server/services/staff'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

const month = currentMonth()
const d1 = monthFirstDay(month)

async function scenario() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator', 'Alaa')
  const s1 = await makeStaff('specialist', 'S1')
  await createEmployee(owner.actor, { fullName: 'راتب', role: 'driver', initialSalaryHalalas: 300000, salaryEffectiveFrom: '2026-01-01' })
  const { svc, pkg } = await catalog()
  const mk = async (lines: unknown[], vs: unknown[]) => {
    const { customer, address } = await customerWithAddress(mod.actor)
    const r = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines, visits: vs }, { confirm: true })
    return getOrderDetail(mod.actor, r.id)
  }
  const swedish = await svc('massage_swedish')
  const a = await mk([{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit(d1, '20:00', [s1.employee.id])])
  await recordPayment(mod.actor, a.order.id, { method: 'bank_transfer', amountHalalas: 5000, isDeposit: true, reference: 'dep' })
  await recordPayment(owner.actor, a.order.id, { method: 'bank_transfer', amountHalalas: 1, reference: 'own' }) // approved directly
  await completeVisit(s1.actor, a.visits[0]!.id)

  const p = await pkg('pkg_swedish_2')
  const b = await mk([{ kind: 'package', packageId: p.id, visitIndexes: [0, 1] }], [visit(d1, '22:00', [s1.employee.id]), visit(`${nextMonth(month)}-05`, '20:00', [s1.employee.id])])
  await recordPayment(s1.actor, b.order.id, { method: 'cash', amountHalalas: 49600 })
  await completeVisit(s1.actor, b.visits[0]!.id)

  // Test order: must never appear in reports.
  const t = await mk([{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit(addDays(d1, 1), '20:00', [s1.employee.id])])
  await getDb().update(orders).set({ isTest: true }).where(eq(orders.id, t.order.id))

  const [supplies] = await getDb().select().from(expenseCategories).where(eq(expenseCategories.code, 'supplies'))
  await createExpense(owner.actor, { categoryId: supplies!.id, amountHalalas: 25000, periodMonth: month, description: 'خامات', paidOn: d1 }, { approve: true })
  return { owner, mod, s1, a, b }
}

describe('monthly report (spec §15–16)', () => {
  it('separates booked, executed, collected, deferred and outstanding; excludes test data', async () => {
    const { owner } = await scenario()
    const r = await monthlyReport(owner.actor, month)
    if (!r.finance) throw new Error('expected finance')
    expect(r.sales.bookedValue).toBe(19600 + 49600)
    expect(r.sales.bookings).toBe(2)
    expect(r.executedRevenue).toBe(19600 + 24800) // package: only the executed session
    expect(r.collections.total).toBe(5001 + 49600 - 5000) // pending transfer (5000) not counted
    expect(r.collections.byMethod).toEqual({ bank_transfer: 1, cash: 49600 })
    expect(r.deferred).toBe(24800) // collected for the second session, not yet earned
    expect(r.outstanding).toBe(19600 - 1)
    expect(r.expenses.byCategory).toEqual([expect.objectContaining({ code: 'supplies', amount: 25000 })])
    expect(r.expenses.salaries).toBe(300000)
    // Specialist commission: 5 (service fully paid? no → 0) + 5 (package session 1, fully paid) = 5
    expect(r.expenses.commissions).toBe(500)
    expect(r.operatingResult).toBe(r.executedRevenue - r.expenses.total)
    expect(r.cashFlow.net).toBe(r.collections.total - 25000)
  })

  it('acceptance #21: every figure equals the sum of the rows behind it', async () => {
    const { owner } = await scenario()
    const r = await monthlyReport(owner.actor, month)
    if (!r.finance) throw new Error('expected finance')
    const sum = async (m: Parameters<typeof metricRows>[1]) => (await metricRows(owner.actor, m, month)).reduce((a, x) => a + (x.amount as number), 0)
    expect(await sum('booked')).toBe(r.sales.bookedValue)
    expect(await sum('executed')).toBe(r.executedRevenue)
    expect(await sum('collections')).toBe(r.collections.total)
    expect(await sum('outstanding')).toBe(r.outstanding)
    expect(await sum('deferred')).toBe(r.deferred)
    expect(await sum('expenses')).toBe(r.expenses.byCategory.reduce((a, c) => a + c.amount, 0))
    expect(await sum('commissions')).toBe(r.expenses.commissions)
  })

  it('acceptance #2: the moderator sees sales but never expenses, salaries or profit — also via the API', async () => {
    const { mod } = await scenario()
    const r = await monthlyReport(mod.actor, month)
    expect(r.finance).toBe(false)
    expect(JSON.stringify(r)).not.toMatch(/operatingResult|salaries|expenses|cashFlow/)
    await expect(metricRows(mod.actor, 'expenses', month)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(metricRows(mod.actor, 'collections', month)).rejects.toBeInstanceOf(ForbiddenError)
    const token = mod.token
    const req = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { cookie: `pm_session=${token}` } })
    const api = await monthlyApi(req(`/api/reports/monthly?month=${month}`), undefined as never)
    expect(api.status).toBe(200)
    expect(await api.text()).not.toMatch(/operatingResult|salaries/)
    expect((await exportCsv(req(`/api/reports/export?metric=expenses&month=${month}`), undefined as never)).status).toBe(403)
    const ok = await exportCsv(req(`/api/reports/export?metric=booked&month=${month}`), undefined as never)
    expect(ok.status).toBe(200)
    expect([...new Uint8Array(await ok.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM
  })

  it('CSV keeps Arabic and formats SAR amounts', () => {
    const csv = toCsv([{ reference: 'PM-1', customer: 'نورة، "التجربة"', amount: 19650 }])
    expect(csv).toBe('﻿reference,customer,amount\r\nPM-1,"نورة، ""التجربة""",196.50')
  })
})
