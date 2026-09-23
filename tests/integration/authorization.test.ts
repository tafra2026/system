import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GET as getSalaries } from '@/app/api/staff/[id]/salaries/route'
import { GET as getStaff } from '@/app/api/staff/route'
import { GET as getMe } from '@/app/api/me/route'
import { ForbiddenError } from '@/server/authz/errors'
import { hasPermission, PERMISSIONS, ROLE_PERMISSIONS } from '@/server/authz/permissions'
import { closeDb } from '@/server/db'
import { addSalaryRecord, createEmployee, listStaff, salaryHistory, staffSummary } from '@/server/services/staff'
import { listAudit } from '@/server/services/audit-read'
import { makeStaff, resetDb } from '../support/db'

const req = (path: string, token?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: token ? { cookie: `pm_session=${token}` } : {} })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(resetDb)
afterAll(closeDb)

describe('permission matrix (spec §4)', () => {
  it('owner and administrative manager have identical full permissions', () => {
    expect([...ROLE_PERMISSIONS.admin_manager].sort()).toEqual([...PERMISSIONS].sort())
    expect([...ROLE_PERMISSIONS.owner].sort()).toEqual([...PERMISSIONS].sort())
  })

  it('moderator: operations yes; salaries, company finance, profit, audit no', () => {
    for (const p of ['customers.manage', 'orders.manage', 'schedule.manage', 'pricing.adjust', 'services.custom', 'vip.manage', 'sales.read', 'payments.links', 'commissions.read.own'] as const) {
      expect(hasPermission('moderator', p), p).toBe(true)
    }
    for (const p of ['salaries.read', 'salaries.manage', 'finance.company.read', 'expenses.manage', 'payroll.manage', 'commissions.read.all', 'audit.read', 'staff.manage'] as const) {
      expect(hasPermission('moderator', p), p).toBe(false)
    }
  })

  it('specialist and driver never see company finance or other people’s commissions', () => {
    for (const role of ['specialist', 'driver'] as const) {
      for (const p of ['salaries.read', 'finance.company.read', 'commissions.read.all', 'sales.read', 'staff.read'] as const) {
        expect(hasPermission(role, p), `${role} ${p}`).toBe(false)
      }
    }
    expect(hasPermission('driver', 'commissions.read.own')).toBe(false)
  })
})

describe('acceptance #2: moderator cannot reach salaries even by calling the API directly', () => {
  it('HTTP API: 403 on salary history, no salary fields in the staff list', async () => {
    const owner = await makeStaff('owner')
    const mod = await makeStaff('moderator')
    const spec = await makeStaff('specialist')
    await addSalaryRecord(owner.actor, spec.employee.id, { amountHalalas: 450000, effectiveFrom: '2099-01-01', reason: null })

    const denied = await getSalaries(req(`/api/staff/${spec.employee.id}/salaries`, mod.token), ctx(spec.employee.id))
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain('450000')

    const list = await getStaff(req('/api/staff', mod.token), undefined as never)
    expect(list.status).toBe(200)
    const body = await list.text()
    expect(body).not.toMatch(/salary/i)

    const ok = await getSalaries(req(`/api/staff/${spec.employee.id}/salaries`, owner.token), ctx(spec.employee.id))
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('450000')
  })

  it('service layer: forbidden regardless of the UI', async () => {
    const mod = await makeStaff('moderator')
    const spec = await makeStaff('specialist')
    await expect(salaryHistory(mod.actor, spec.employee.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffSummary(mod.actor)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(listAudit(mod.actor)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(addSalaryRecord(mod.actor, spec.employee.id, { amountHalalas: 1, effectiveFrom: '2099-01-01', reason: null })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createEmployee(mod.actor, { fullName: 'x', role: 'specialist' })).rejects.toBeInstanceOf(ForbiddenError)
    const staff = await listStaff(mod.actor)
    expect(staff.every((s) => !('currentSalaryHalalas' in s))).toBe(true)
  })

  it('specialist cannot list staff; unauthenticated gets 401', async () => {
    const spec = await makeStaff('specialist')
    expect((await getStaff(req('/api/staff', spec.token), undefined as never)).status).toBe(403)
    expect((await getStaff(req('/api/staff'), undefined as never)).status).toBe(401)
    expect((await getStaff(req('/api/staff', 'forged-token'), undefined as never)).status).toBe(401)
    const me = await getMe(req('/api/me', spec.token), undefined as never)
    const meJson = (await me.json()) as { role: string; locale: string; permissions: string[] }
    expect(meJson.role).toBe('specialist')
    expect(meJson.locale).toBe('en')
    expect(meJson.permissions).not.toContain('salaries.read')
  })

  it('API responses are never cacheable', async () => {
    const owner = await makeStaff('owner')
    const res = await getStaff(req('/api/staff', owner.token), undefined as never)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
})
