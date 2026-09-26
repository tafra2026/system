import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { auditLog, orders, visitSpecialists } from '@/server/db/schema'
import { updateService } from '@/server/services/catalog'
import {
  adjustLinePrice,
  completeVisit,
  getOrderDetail,
  listOrders,
  markVisitPendingReview,
  mySchedule,
  rescheduleVisit,
  saveOrder,
} from '@/server/services/orders'
import { setBooleanSetting } from '@/server/services/settings'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator', 'الاء')
  const s1 = await makeStaff('specialist', 'Mavlor')
  const s2 = await makeStaff('specialist', 'Analiza')
  const cat = await catalog()
  return { owner, mod, s1, s2, ...cat }
}

describe('pricing on orders (spec §9)', () => {
  it('VIP 196 → 147, delivery separate, totals and snapshots stored', async () => {
    const { mod, s1, svc } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor, { vip: false })
    await getDb().update((await import('@/server/db/schema')).customers).set({ isVip: true }).where(eq((await import('@/server/db/schema')).customers.id, customer.id))
    const swedish = await svc('massage_swedish')
    const res = await saveOrder(
      mod.actor,
      null,
      { customerId: customer.id, addressId: address.id, deliveryFeeHalalas: 3000, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] },
      { confirm: true },
    )
    expect(res.reference).toMatch(/^PM-\d{4}-\d{4}$/)
    expect(res.status).toBe('confirmed')
    const d = await getOrderDetail(mod.actor, res.id)
    expect(d.lines[0]!.finalPriceHalalas).toBe(14700)
    expect(d.lines[0]!.basePriceHalalas).toBe(25000)
    expect(d.lines[0]!.offerPriceHalalas).toBe(19600)
    expect(d.order.servicesTotalHalalas).toBe(14700)
    expect(d.order.grandTotalHalalas).toBe(17700)
    expect(d.order.moderatorEmployeeId).toBe(mod.employee.id) // moderator becomes responsible by default
    expect((d.order.commissionRules as { version: string }).version).toBe('v1')
    // Item auto-assigned to the only specialist.
    expect(d.visits[0]!.items[0]!.specialistEmployeeId).toBe(s1.employee.id)
  })

  it('acceptance #6: delivery 31 rejected; #5: final above base rejected', async () => {
    const { mod, s1, svc } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor)
    const swedish = await svc('massage_swedish')
    const base = { customerId: customer.id, addressId: address.id, visits: [visit('2026-10-01', '20:00', [s1.employee.id])] }
    await expect(saveOrder(mod.actor, null, { ...base, deliveryFeeHalalas: 3100, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }] }, { confirm: true })).rejects.toMatchObject({
      fieldErrors: { deliveryFeeHalalas: 'delivery_fee_out_of_range' },
    })
    await expect(
      saveOrder(mod.actor, null, { ...base, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0, manualFinalPrice: 25100, manualReason: 'x' }] }, { confirm: true }),
    ).rejects.toMatchObject({ fieldErrors: { 'lines.0': 'final_exceeds_base' } })
  })

  it('moderator may adjust with a reason (audited); a price-list change never touches existing orders', async () => {
    const { owner, mod, s1, svc } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor)
    const swedish = await svc('massage_swedish')
    const res = await saveOrder(
      mod.actor,
      null,
      { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0, manualFinalPrice: 18000, manualReason: 'عرض خاص' }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] },
      { confirm: true },
    )
    await updateService(owner.actor, swedish.id, { nameAr: swedish.nameAr, nameEn: swedish.nameEn, basePriceHalalas: 30000, offerPriceHalalas: 25000, durationMinutes: 60, active: true })
    const d = await getOrderDetail(mod.actor, res.id)
    expect(d.lines[0]!.finalPriceHalalas).toBe(18000)
    expect(d.lines[0]!.basePriceHalalas).toBe(25000)
    const audit = await getDb().select().from(auditLog).where(eq(auditLog.action, 'order.line_price_manual'))
    expect(audit[0]!.reason).toBe('عرض خاص')
    // Later adjustment recomputes from snapshots.
    await adjustLinePrice(mod.actor, d.lines[0]!.id, null, null)
    expect((await getOrderDetail(mod.actor, res.id)).order.servicesTotalHalalas).toBe(19600)
  })

  it('custom service: explicit price, VIP only when ticked, needs services.custom', async () => {
    const { mod, s1 } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor, { vip: true })
    const res = await saveOrder(
      mod.actor,
      null,
      {
        customerId: customer.id,
        addressId: address.id,
        lines: [
          { kind: 'custom', name: 'حنة', priceHalalas: 10000, durationMinutes: 45, beneficiaryIndex: 1, visitIndex: 0, vipEligible: false },
          { kind: 'custom', name: 'رسم', priceHalalas: 10000, durationMinutes: 15, beneficiaryIndex: 1, visitIndex: 0, vipEligible: true },
        ],
        visits: [visit('2026-10-01', '20:00', [s1.employee.id])],
      },
      { confirm: true },
    )
    const d = await getOrderDetail(mod.actor, res.id)
    expect(d.lines.map((l) => l.finalPriceHalalas)).toEqual([10000, 7500])
    expect(d.visits[0]!.durationMinutes).toBe(60) // suggested from tasks (45+15, one specialist)
  })

  it('VIP on packages follows the visible setting', async () => {
    const { owner, mod, s1, s2, pkg } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor, { vip: true })
    const relax = await pkg('pkg_complete_relaxation')
    const input = { customerId: customer.id, addressId: address.id, lines: [{ kind: 'package', packageId: relax.id, visitIndexes: [0] }], visits: [visit('2026-10-01', '20:00', [s1.employee.id, s2.employee.id])] }
    const a = await saveOrder(mod.actor, null, input, { confirm: false })
    expect((await getOrderDetail(mod.actor, a.id)).order.servicesTotalHalalas).toBe(37200) // 496 × 75%
    await setBooleanSetting(owner.actor, 'vip_applies_to_packages', false)
    const b = await saveOrder(mod.actor, null, input, { confirm: false })
    expect((await getOrderDetail(mod.actor, b.id)).order.servicesTotalHalalas).toBe(49600)
  })
})

describe('packages and visits (spec §6, §8)', () => {
  it('two-visit package: priced once, two visits, session balance, no double consumption', async () => {
    const { mod, s1, s2, pkg } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor)
    const swedish2 = await pkg('pkg_swedish_2')
    const res = await saveOrder(
      mod.actor,
      null,
      { customerId: customer.id, addressId: address.id, lines: [{ kind: 'package', packageId: swedish2.id, visitIndexes: [0, 1] }], visits: [visit('2026-10-01', '20:00', [s1.employee.id]), visit(null, null)] },
      { confirm: true },
    )
    let d = await getOrderDetail(mod.actor, res.id)
    expect(d.order.servicesTotalHalalas).toBe(49600)
    expect(d.lines).toHaveLength(1)
    expect(d.visits.map((v) => [v.status, v.durationMinutes])).toEqual([
      ['scheduled', 60],
      ['unscheduled', 60],
    ])
    expect(d.lines[0]!.balance).toEqual({ total: 2, used: 0, scheduled: 1, pendingReview: 0, cancelled: 0, remaining: 1 })

    // Second session booked later with a different specialist; order value unchanged.
    await rescheduleVisit(mod.actor, d.visits[1]!.id, { date: '2026-10-08', time: '21:00', durationMinutes: 60, specialistIds: [s2.employee.id] })
    await completeVisit(s1.actor, d.visits[0]!.id)
    await completeVisit(s1.actor, d.visits[0]!.id) // double tap: no effect
    d = await getOrderDetail(mod.actor, res.id)
    expect(d.lines[0]!.balance).toEqual({ total: 2, used: 1, scheduled: 1, pendingReview: 0, cancelled: 0, remaining: 0 })
    expect(d.order.status).toBe('confirmed')
    expect(d.order.servicesTotalHalalas).toBe(49600)
    await completeVisit(s2.actor, d.visits[1]!.id)
    d = await getOrderDetail(mod.actor, res.id)
    expect(d.order.status).toBe('completed')
    expect(d.lines[0]!.balance!.used).toBe(2)
    const completions = await getDb().select().from(auditLog).where(eq(auditLog.action, 'visit.complete'))
    expect(completions).toHaveLength(2)
  })

  it('a package visit keeps its declared duration; components are listed per beneficiary', async () => {
    const { mod, s1, s2, pkg } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor)
    const friends = await pkg('pkg_friends')
    const input = { customerId: customer.id, addressId: address.id, lines: [{ kind: 'package', packageId: friends.id, visitIndexes: [0] }], visits: [visit('2026-10-01', '20:00', [s1.employee.id, s2.employee.id])] }
    await expect(saveOrder(mod.actor, null, input, { confirm: true })).rejects.toMatchObject({ fieldErrors: { personsCount: 'package_persons' } })
    const res = await saveOrder(mod.actor, null, { ...input, personsCount: 2 }, { confirm: true })
    const d = await getOrderDetail(mod.actor, res.id)
    expect(d.visits[0]!.durationMinutes).toBe(120)
    expect(d.visits[0]!.items.map((i) => i.beneficiaryIndex)).toEqual([1, 2, 1, 2])
    // Both specialists are reserved for the whole visit (conservative).
    const blocks = await getDb().select().from(visitSpecialists).where(eq(visitSpecialists.visitId, d.visits[0]!.id))
    expect(blocks.every((b) => b.blocking && b.endsAt!.getTime() - b.startsAt!.getTime() === 120 * 60_000)).toBe(true)
  })

  it('Relax & Care stays a one-person package', async () => {
    const { mod, s1, s2, pkg } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor)
    const rc = await pkg('pkg_relax_care')
    const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'package', packageId: rc.id, visitIndexes: [0] }], visits: [visit('2026-10-01', '20:00', [s1.employee.id, s2.employee.id])] }, { confirm: true })
    const d = await getOrderDetail(mod.actor, res.id)
    expect(d.order.personsCount).toBe(1)
    expect(d.visits[0]!.durationMinutes).toBe(160)
    expect(new Set(d.visits[0]!.items.map((i) => i.beneficiaryIndex))).toEqual(new Set([1]))
  })

  it('confirmation requires address, schedule and specialists; drafts do not', async () => {
    const { mod, svc } = await setup()
    const { customer } = await customerWithAddress(mod.actor)
    const swedish = await svc('massage_swedish')
    const input = { customerId: customer.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit(null, null)] }
    const draft = await saveOrder(mod.actor, null, input, { confirm: false })
    expect(draft.status).toBe('draft')
    await expect(saveOrder(mod.actor, draft.id, input, { confirm: true })).rejects.toMatchObject({ fieldErrors: { addressId: 'required' } })
  })

  it('acceptance #17: start 03:00 allowed (previous operational day), 03:30 rejected', async () => {
    const { mod, s1, svc } = await setup()
    const { customer, address } = await customerWithAddress(mod.actor)
    const swedish = await svc('massage_swedish')
    const make = (time: string) => ({ customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-02', time, [s1.employee.id])] })
    const ok = await saveOrder(mod.actor, null, make('03:00'), { confirm: true })
    const d = await getOrderDetail(mod.actor, ok.id)
    expect(d.visits[0]!.operationalDate).toBe('2026-10-01')
    await expect(saveOrder(mod.actor, null, make('03:30'), { confirm: true })).rejects.toMatchObject({ fieldErrors: { 'visits.0': 'outside_hours' } })
  })
})

describe('no double booking (acceptance #16, specialist part)', () => {
  const book = async (ctx: Awaited<ReturnType<typeof setup>>, time: string, confirm = true) => {
    const { customer, address } = await customerWithAddress(ctx.mod.actor)
    const swedish = await ctx.svc('massage_swedish')
    return saveOrder(ctx.mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', time, [ctx.s1.employee.id])] }, { confirm })
  }

  it('overlap is rejected; back-to-back is allowed; drafts do not reserve', async () => {
    const ctx = await setup()
    await book(ctx, '20:00')
    await expect(book(ctx, '20:30')).rejects.toMatchObject({ code: 'specialist_conflict' })
    await expect(book(ctx, '21:00')).resolves.toBeTruthy()
    await expect(book(ctx, '20:15', false)).resolves.toBeTruthy()
  })

  it('concurrent confirmations: exactly one wins', async () => {
    const ctx = await setup()
    const results = await Promise.allSettled([book(ctx, '18:00'), book(ctx, '18:30'), book(ctx, '18:15')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'specialist_conflict' })
  })

  it('pending review releases the time and never counts as executed', async () => {
    const ctx = await setup()
    const first = await book(ctx, '20:00')
    const d = await getOrderDetail(ctx.mod.actor, first.id)
    await markVisitPendingReview(ctx.mod.actor, d.visits[0]!.id, 'العميلة غير موجودة')
    const after = await getOrderDetail(ctx.mod.actor, first.id)
    expect(after.order.status).toBe('pending_review')
    expect(after.order.grandTotalHalalas).toBe(d.order.grandTotalHalalas)
    await expect(book(ctx, '20:00')).resolves.toBeTruthy()
  })
})

describe('order permissions', () => {
  it('specialists cannot create or list orders, and complete only their own visits', async () => {
    const ctx = await setup()
    const { customer, address } = await customerWithAddress(ctx.mod.actor)
    const swedish = await ctx.svc('massage_swedish')
    const input = { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [ctx.s1.employee.id])] }
    await expect(saveOrder(ctx.s1.actor, null, input, { confirm: true })).rejects.toBeInstanceOf(ForbiddenError)
    const res = await saveOrder(ctx.mod.actor, null, input, { confirm: true })
    await expect(listOrders(ctx.s1.actor)).rejects.toBeInstanceOf(ForbiddenError)
    const d = await getOrderDetail(ctx.mod.actor, res.id)
    await expect(completeVisit(ctx.s2.actor, d.visits[0]!.id)).rejects.toBeInstanceOf(ForbiddenError)
    const driver = await (await import('../support/db')).makeStaff('driver')
    await expect(completeVisit(driver.actor, d.visits[0]!.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('a specialist schedule has no prices and shows only her visits', async () => {
    const ctx = await setup()
    const { customer, address } = await customerWithAddress(ctx.mod.actor)
    const swedish = await ctx.svc('massage_swedish')
    await saveOrder(ctx.mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [ctx.s1.employee.id])] }, { confirm: true })
    const mine = await mySchedule(ctx.s1.actor, '2026-10-01', '2026-10-01')
    expect(mine).toHaveLength(1)
    expect(mine[0]!.items[0]).toMatchObject({ name: 'Swedish massage', mine: true })
    // Only the balance left to collect is shown — never the price breakdown.
    expect(JSON.stringify(mine)).not.toMatch(/price|servicesTotal|grandTotal|vipDiscount/i)
    expect(mine[0]!.remainingHalalas).toBe(19600)
    expect(mine[0]!.address?.district).toBe('الروضة')
    expect(await mySchedule(ctx.s2.actor, '2026-10-01', '2026-10-01')).toHaveLength(0)
  })

  it('free service needs a reason and is recorded', async () => {
    const ctx = await setup()
    const { customer, address } = await customerWithAddress(ctx.mod.actor)
    const swedish = await ctx.svc('massage_swedish')
    const line = { kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0, manualFinalPrice: 0 }
    const base = { customerId: customer.id, addressId: address.id, visits: [visit('2026-10-01', '20:00', [ctx.s1.employee.id])] }
    await expect(saveOrder(ctx.mod.actor, null, { ...base, lines: [line] }, { confirm: true })).rejects.toMatchObject({ fieldErrors: { 'lines.0': 'manual_price_reason_required' } })
    const res = await saveOrder(ctx.mod.actor, null, { ...base, lines: [{ ...line, manualReason: 'تعويض' }] }, { confirm: true })
    const [o] = await getDb().select().from(orders).where(eq(orders.id, res.id))
    expect(o!.grandTotalHalalas).toBe(0)
  })
})

describe('orders list filters', () => {
  it('filters by operational date and shows the first visit time', async () => {
    const ctx = await setup()
    const { customer, address } = await customerWithAddress(ctx.mod.actor)
    const swedish = await ctx.svc('massage_swedish')
    const mk = (date: string) => saveOrder(ctx.mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit(date, '20:00', [ctx.s1.employee.id])] }, { confirm: true })
    const a = await mk('2026-10-01')
    const b = await mk('2026-10-05')
    const onlyA = await listOrders(ctx.mod.actor, { from: '2026-10-01', to: '2026-10-02' })
    expect(onlyA.map((o) => o.id)).toEqual([a.id])
    const fromB = await listOrders(ctx.mod.actor, { from: '2026-10-03' })
    expect(fromB.map((o) => o.id)).toEqual([b.id])
    expect(fromB[0]!.firstStart?.toISOString()).toBe('2026-10-05T17:00:00.000Z')
    expect(fromB[0]!.visitCount).toBe(1)
  })
})
