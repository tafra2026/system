import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { commissionEntries, expenseCategories, expenses } from '@/server/db/schema'
import { approveExpense, createExpense, createRecurring, generateRecurringDrafts, listExpenses, voidExpense } from '@/server/services/expenses'
import { addPayrollAdjustment, advanceBalances, approveRun, closeRun, createAdvance, getRun, prepareRun, recordPayrollPayment } from '@/server/services/payroll'
import { createEmployee } from '@/server/services/staff'
import { makeStaff, resetDb } from '../support/db'

beforeEach(resetDb)
afterAll(closeDb)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const spec = await createEmployee(owner.actor, { fullName: 'مافلور', role: 'specialist', initialSalaryHalalas: 450000, salaryEffectiveFrom: '2026-01-01' })
  return { owner, mod, spec }
}

describe('expenses', () => {
  it('draft → approved → voided with reason; recurring drafts once per month; moderator has no access', async () => {
    const { owner, mod } = await setup()
    const [supplies] = await getDb().select().from(expenseCategories).where(eq(expenseCategories.code, 'supplies'))
    const e = await createExpense(owner.actor, { categoryId: supplies!.id, amountHalalas: 25000, periodMonth: '2026-09', description: 'زيوت مساج', itemName: 'زيت لوز' })
    expect(e.status).toBe('draft')
    await approveExpense(owner.actor, e.id)
    await expect(voidExpense(owner.actor, e.id, '')).rejects.toMatchObject({ fieldErrors: { reason: 'required' } })
    await voidExpense(owner.actor, e.id, 'مكرر')
    const [row] = await getDb().select().from(expenses).where(eq(expenses.id, e.id))
    expect(row!.status).toBe('voided')

    const [ads] = await getDb().select().from(expenseCategories).where(eq(expenseCategories.code, 'marketing_contract'))
    await createRecurring(owner.actor, { categoryId: ads!.id, amountHalalas: 300000, description: 'عقد التسويق الشهري' })
    expect(await generateRecurringDrafts(owner.actor, '2026-10')).toBe(1)
    expect(await generateRecurringDrafts(owner.actor, '2026-10')).toBe(0)
    expect((await listExpenses(owner.actor, '2026-10')).map((x) => x.e.status)).toEqual(['draft'])

    await expect(listExpenses(mod.actor, '2026-10')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(prepareRun(mod.actor, '2026-08')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('payroll (spec §15)', () => {
  it('base + earned commissions + bonus − deduction − advance installment; commissions settled once; advance not an expense', async () => {
    const { owner, spec } = await setup()
    const db = getDb()
    // A commission earned in August, and one earned in September.
    await db.insert(commissionEntries).values([
      { employeeId: spec.id, kind: 'specialist', amountHalalas: 1500, earnedAt: new Date('2026-08-20T12:00:00Z') },
      { employeeId: spec.id, kind: 'specialist', amountHalalas: 500, earnedAt: new Date('2026-09-02T12:00:00Z') },
    ])
    await createAdvance(owner.actor, { employeeId: spec.id, amountHalalas: 100000, monthlyInstallmentHalalas: 50000, givenOn: '2026-08-10' })
    await addPayrollAdjustment(owner.actor, { month: '2026-08', employeeId: spec.id, kind: 'bonus', amountHalalas: 10000, reason: 'تقييم ممتاز' })
    await addPayrollAdjustment(owner.actor, { month: '2026-08', employeeId: spec.id, kind: 'deduction', amountHalalas: 5000, reason: 'تأخير' })

    await prepareRun(owner.actor, '2026-08')
    let run = await getRun(owner.actor, '2026-08')
    const item = run!.items.find((i) => i.employeeId === spec.id)!
    expect(item).toMatchObject({ baseSalaryHalalas: 450000, commissionsHalalas: 1500, bonusesHalalas: 10000, deductionsHalalas: 5000, advanceDeductionHalalas: 50000, netHalalas: 406500 })

    await approveRun(owner.actor, '2026-08')
    await approveRun(owner.actor, '2026-08') // idempotent
    // The August commission is settled; September's draft only has the September one.
    await prepareRun(owner.actor, '2026-09')
    const sep = (await getRun(owner.actor, '2026-09'))!.items.find((i) => i.employeeId === spec.id)!
    expect(sep.commissionsHalalas).toBe(500)
    expect(sep.advanceDeductionHalalas).toBe(50000)
    expect((await advanceBalances(db, [spec.id]))[0]!.outstandingHalalas).toBe(50000)

    // Approved month is frozen; corrections go to the next month.
    await expect(addPayrollAdjustment(owner.actor, { month: '2026-08', employeeId: spec.id, kind: 'bonus', amountHalalas: 100, reason: 'x' })).rejects.toMatchObject({ code: 'payroll_month_locked' })
    await expect(db.execute(sql`UPDATE payroll_items SET net_halalas = 1 WHERE employee_id = ${spec.id} AND base_salary_halalas = 450000 AND commissions_halalas = 1500`)).rejects.toThrow()

    // Payment 5–10 of next month (actual date recorded), cannot exceed net; close only when paid.
    run = await getRun(owner.actor, '2026-08')
    const it = run!.items.find((i) => i.employeeId === spec.id)!
    await expect(closeRun(owner.actor, '2026-08')).rejects.toMatchObject({ code: 'payroll_unpaid' })
    await expect(recordPayrollPayment(owner.actor, it.id, { amountHalalas: it.netHalalas + 1, paidOn: '2026-09-05', method: 'bank_transfer' })).rejects.toMatchObject({ fieldErrors: { amountHalalas: 'payroll_overpaid' } })
    for (const x of run!.items) await recordPayrollPayment(owner.actor, x.id, { amountHalalas: x.netHalalas, paidOn: '2026-09-05', method: 'bank_transfer' })
    await closeRun(owner.actor, '2026-08')
    expect((await getRun(owner.actor, '2026-08'))!.run.status).toBe('closed')
  })

  it('cannot approve before the month has ended', async () => {
    const { owner } = await setup()
    await prepareRun(owner.actor, '2099-01')
    await expect(approveRun(owner.actor, '2099-01')).rejects.toMatchObject({ code: 'payroll_month_not_ended' })
  })
})
