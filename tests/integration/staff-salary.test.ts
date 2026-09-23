import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { riyadhMonthStart } from '@/domain/operational-day'
import { getDb, closeDb } from '@/server/db'
import { salaryRecords } from '@/server/db/schema'
import {
  addSalaryRecord,
  changeRole,
  createEmployee,
  listStaff,
  salariesOn,
  setEmployeeStatus,
  staffSummary,
} from '@/server/services/staff'
import { makeStaff, resetDb } from '../support/db'

beforeEach(resetDb)
afterAll(closeDb)

describe('salaries are effective-dated and append-only (acceptance #20, salary part)', () => {
  it('a new salary never rewrites earlier months', async () => {
    const owner = await makeStaff('owner')
    const db = getDb()
    const emp = await createEmployee(owner.actor, { fullName: 'روزان', role: 'specialist', initialSalaryHalalas: 270000, salaryEffectiveFrom: '2026-01-01' })
    await addSalaryRecord(owner.actor, emp.id, { amountHalalas: 300000, effectiveFrom: '2099-03-01', reason: 'raise' })

    expect((await salariesOn(db, [emp.id], '2026-02-15')).get(emp.id)).toBe(270000)
    expect((await salariesOn(db, [emp.id], '2099-02-28')).get(emp.id)).toBe(270000)
    expect((await salariesOn(db, [emp.id], '2099-03-01')).get(emp.id)).toBe(300000)
    expect((await salariesOn(db, [emp.id], '2025-12-31')).has(emp.id)).toBe(false)
  })

  it('rejects a retroactive salary before the current month', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'x', role: 'driver', initialSalaryHalalas: 300000, salaryEffectiveFrom: '2026-01-01' })
    const lastMonth = new Date(`${riyadhMonthStart()}T00:00:00Z`)
    lastMonth.setUTCDate(0)
    await expect(addSalaryRecord(owner.actor, emp.id, { amountHalalas: 1, effectiveFrom: lastMonth.toISOString().slice(0, 10), reason: null })).rejects.toMatchObject({ fieldErrors: { effectiveFrom: 'salary_backdated' } })
  })

  it('a correction in the same open month supersedes by creation order', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'x', role: 'driver' })
    await addSalaryRecord(owner.actor, emp.id, { amountHalalas: 300000, effectiveFrom: '2099-05-01', reason: null })
    await addSalaryRecord(owner.actor, emp.id, { amountHalalas: 310000, effectiveFrom: '2099-05-01', reason: 'typo fix' })
    expect((await salariesOn(getDb(), [emp.id], '2099-05-02')).get(emp.id)).toBe(310000)
  })

  it('the database refuses UPDATE/DELETE on salary history and the audit log', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'x', role: 'driver', initialSalaryHalalas: 100, salaryEffectiveFrom: '2026-01-01' })
    const db = getDb()
    await expect(db.update(salaryRecords).set({ monthlySalaryHalalas: 1 })).rejects.toThrow()
    await expect(db.delete(salaryRecords)).rejects.toThrow()
    await expect(db.execute(sql`UPDATE audit_log SET reason = 'tamper'`)).rejects.toThrow()
    await expect(db.execute(sql`DELETE FROM audit_log`)).rejects.toThrow()
    expect((await salariesOn(db, [emp.id], '2026-02-01')).get(emp.id)).toBe(100)
  })

  it('rejects negative or fractional amounts', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'x', role: 'driver' })
    await expect(addSalaryRecord(owner.actor, emp.id, { amountHalalas: -1, effectiveFrom: '2099-01-01', reason: null })).rejects.toThrow()
    await expect(addSalaryRecord(owner.actor, emp.id, { amountHalalas: 1.5, effectiveFrom: '2099-01-01', reason: null })).rejects.toThrow()
  })
})

describe('staff management', () => {
  it('summary totals only real salaries in effect today and counts missing ones', async () => {
    const owner = await makeStaff('owner')
    await createEmployee(owner.actor, { fullName: 'a', role: 'specialist', initialSalaryHalalas: 450000, salaryEffectiveFrom: '2026-01-01' })
    await createEmployee(owner.actor, { fullName: 'b', role: 'moderator', initialSalaryHalalas: 100000, salaryEffectiveFrom: '2026-01-01' })
    const s = await staffSummary(owner.actor)
    expect(s.activeCount).toBe(3)
    expect(s.monthlySalaryTotalHalalas).toBe(550000)
    expect(s.withoutSalary).toBe(1) // the owner
  })

  it('archiving keeps history and blocks sign-in; nothing is deleted', async () => {
    const owner = await makeStaff('owner')
    const spec = await makeStaff('specialist')
    await setEmployeeStatus(owner.actor, spec.employee.id, 'inactive', 'left')
    await setEmployeeStatus(owner.actor, spec.employee.id, 'archived', null)
    expect((await listStaff(owner.actor)).find((s) => s.id === spec.employee.id)).toBeUndefined()
    const all = await listStaff(owner.actor, { includeArchived: true })
    expect(all.find((s) => s.id === spec.employee.id)?.status).toBe('archived')
    expect(all.find((s) => s.id === spec.employee.id)?.account?.status).toBe('suspended')
  })

  it('management cannot lock itself out', async () => {
    const owner = await makeStaff('owner')
    await expect(setEmployeeStatus(owner.actor, owner.employee.id, 'inactive', null)).rejects.toMatchObject({ code: 'cannot_deactivate_self' })
    await expect(changeRole(owner.actor, owner.employee.id, 'moderator', null)).rejects.toMatchObject({ code: 'cannot_change_own_role' })
    const admin = await makeStaff('admin_manager')
    await setEmployeeStatus(owner.actor, admin.employee.id, 'inactive', null)
    // Owner is now the only active manager; the admin (reactivated) cannot demote her.
    await setEmployeeStatus(owner.actor, admin.employee.id, 'active', null)
    await setEmployeeStatus(admin.actor, owner.employee.id, 'inactive', null)
    await expect(changeRole(owner.actor, admin.employee.id, 'driver', null)).rejects.toMatchObject({ code: 'last_manager' })
  })

  it('validates input on the server', async () => {
    const owner = await makeStaff('owner')
    await expect(createEmployee(owner.actor, { fullName: '   ', role: 'specialist' })).rejects.toMatchObject({ fieldErrors: { fullName: 'required' } })
    await expect(createEmployee(owner.actor, { fullName: 'x', role: 'boss' })).rejects.toMatchObject({ fieldErrors: { role: 'invalid' } })
    await expect(createEmployee(owner.actor, { fullName: 'x', role: 'driver', phone: '123' })).rejects.toMatchObject({ fieldErrors: { phone: 'phone_invalid' } })
    const ok = await createEmployee(owner.actor, { fullName: 'x', role: 'driver', phone: '0501234567' })
    expect(ok.phoneE164).toBe('+966501234567')
  })
})
