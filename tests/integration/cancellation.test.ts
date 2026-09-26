import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { commissionEntries, messageTasks, notifications, orders, visitSpecialists } from '@/server/db/schema'
import { cancelOrder, cancelVisit, completeVisit, getOrderDetail, saveOrder } from '@/server/services/orders'
import { recordPayment } from '@/server/services/payments'
import { monthlyReport } from '@/server/services/reports'
import { setSetting } from '@/server/services/settings'
import { myTrips, saveLeg } from '@/server/services/trips'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist', 'S1')
  const driver = await makeStaff('driver', 'D1')
  const cat = await catalog()
  await setSetting(owner.actor, 'start_point', { label: 'السكن', latitude: 21.59, longitude: 39.14 })
  const { customer, address } = await customerWithAddress(mod.actor)
  return { owner, mod, s1, driver, cat, customer, address }
}

describe('cancelling an order (D72)', () => {
  it('keeps the order and payments, frees everyone, stops messages, and shows the money for settlement', async () => {
    const { owner, mod, s1, driver, cat, customer, address } = await setup()
    const swedish = await cat.svc('massage_swedish')
    const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] }, { confirm: true })
    const v = (await getOrderDetail(mod.actor, res.id)).visits[0]!
    await saveLeg(mod.actor, v.id, { kind: 'dropoff', driverId: driver.employee.id, originVisitId: null, mode: 'manual', travelMinutes: 20, bufferMinutes: 15 })
    await recordPayment(owner.actor, res.id, { method: 'cash', amountHalalas: 5000 })

    await expect(cancelOrder(s1.actor, res.id, { reason: 'customer_request' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(cancelOrder(mod.actor, res.id, { reason: 'other' })).rejects.toMatchObject({ fieldErrors: { note: expect.any(String) } })
    const out = await cancelOrder(mod.actor, res.id, { reason: 'customer_request', note: 'غيّرت رأيها' })
    expect(out.paidHalalas).toBe(5000) // not refunded automatically

    const [o] = await getDb().select().from(orders).where(eq(orders.id, res.id))
    expect(o).toMatchObject({ status: 'cancelled', cancelReason: 'customer_request', statusBeforeCancel: 'confirmed', cancelledByUserId: mod.actor.userId })
    expect((await getDb().select().from(visitSpecialists).where(eq(visitSpecialists.visitId, v.id))).every((r) => !r.blocking)).toBe(true)
    expect(await myTrips(driver.actor, '2026-10-01', '2026-10-01')).toHaveLength(0)
    const open = await getDb().select().from(messageTasks).where(and(eq(messageTasks.orderId, res.id)))
    expect(open.filter((t) => t.status === 'ready' || t.status === 'opened')).toHaveLength(0)
    const told = (await getDb().select().from(notifications)).map((n) => n.kind)
    expect(told).toEqual(expect.arrayContaining(['visit_unassigned', 'trip_unassigned']))

    // Idempotent; no new payments; excluded from booked sales; no commissions.
    await cancelOrder(mod.actor, res.id, { reason: 'customer_request' })
    await expect(recordPayment(owner.actor, res.id, { method: 'cash', amountHalalas: 100 })).rejects.toMatchObject({ code: 'order_cancelled' })
    const report = await monthlyReport(owner.actor, '2026-09')
    expect(report.sales.bookings).toBe(0)
    expect(await getDb().select().from(commissionEntries)).toHaveLength(0)
  })

  it('a package with an executed session: cancel only the remaining session, never the executed one', async () => {
    const { owner, mod, s1, cat, customer, address } = await setup()
    const swedish2 = await cat.pkg('pkg_swedish_2')
    const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'package', packageId: swedish2.id, visitIndexes: [0, 1] }], visits: [visit('2026-10-01', '20:00', [s1.employee.id]), visit(null, null)] }, { confirm: true })
    const [first, second] = (await getOrderDetail(mod.actor, res.id)).visits
    await completeVisit(mod.actor, first!.id)
    await expect(cancelOrder(mod.actor, res.id, { reason: 'customer_request' })).rejects.toMatchObject({ code: 'order_has_executed_visits' })
    await expect(cancelVisit(mod.actor, first!.id, { reason: 'customer_request' })).rejects.toMatchObject({ code: 'visit_completed' })
    await cancelVisit(owner.actor, second!.id, { reason: 'customer_request' })
    const d = await getOrderDetail(mod.actor, res.id)
    expect(d.order.status).toBe('completed') // the executed session stands; the other is cancelled
    expect(d.visits.map((x) => x.status)).toEqual(['completed', 'cancelled'])
    expect(d.lines[0]!.balance).toMatchObject({ used: 1, cancelled: 1, remaining: 0 })
  })

  it('a fully executed order cannot be cancelled with the normal button', async () => {
    const { mod, s1, cat, customer, address } = await setup()
    const swedish = await cat.svc('massage_swedish')
    const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] }, { confirm: true })
    await completeVisit(mod.actor, (await getOrderDetail(mod.actor, res.id)).visits[0]!.id)
    await expect(cancelOrder(mod.actor, res.id, { reason: 'operational' })).rejects.toMatchObject({ code: 'order_completed' })
  })
})
