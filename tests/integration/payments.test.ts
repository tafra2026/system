import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { commissionEntries, payments } from '@/server/db/schema'
import { allCommissions, myCommissions, orderBalance } from '@/server/services/commissions'
import { completeVisit, getOrderDetail, saveOrder } from '@/server/services/orders'
import { custodySummary, decideTransfer, myCustody, orderPayments, receiveHandover, recordPayment } from '@/server/services/payments'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator', 'Alaa')
  const s1 = await makeStaff('specialist', 'S1')
  const s2 = await makeStaff('specialist', 'S2')
  const cat = await catalog()
  const order = async (lines: unknown[], visits: unknown[], persons = 1) => {
    const { customer, address } = await customerWithAddress(mod.actor)
    const r = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, personsCount: persons, lines, visits }, { confirm: true })
    return getOrderDetail(mod.actor, r.id)
  }
  return { owner, mod, s1, s2, order, ...cat }
}
const entries = async (orderId: string) => getDb().select().from(commissionEntries).where(eq(commissionEntries.orderId, orderId))
const sumFor = (rows: { employeeId: string; amountHalalas: number }[], id: string) => rows.filter((r) => r.employeeId === id).reduce((a, r) => a + r.amountHalalas, 0)

describe('collection (spec §12)', () => {
  it('acceptance #13: deposit, then cash, then Tamara settle the balance exactly once', async () => {
    const { owner, mod, s1, order, svc } = await setup()
    const svcA = await svc('massage_hot_stone') // 296
    const d = await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '20:00', [s1.employee.id])])
    const id = d.order.id
    await recordPayment(mod.actor, id, { method: 'bank_transfer', amountHalalas: 5000, isDeposit: true, reference: 'TRX-1' }) // pending
    expect((await orderBalance(getDb(), id)).confirmed).toBe(0)
    const pending = (await orderPayments(owner.actor, id)).payments[0]!
    await decideTransfer(owner.actor, pending.id, true, null)
    await recordPayment(s1.actor, id, { method: 'cash', amountHalalas: 10000 })
    await recordPayment(owner.actor, id, { method: 'tamara', amountHalalas: 14600, reference: 'TMR-9' })
    const bal = await orderBalance(getDb(), id)
    expect(bal).toMatchObject({ total: 29600, confirmed: 29600, remaining: 0, fullyPaid: true })
    await expect(recordPayment(s1.actor, id, { method: 'cash', amountHalalas: 1 })).rejects.toMatchObject({ code: 'overpayment' })
  })

  it('acceptance #14: a repeated submission/webhook with the same key does not duplicate payment or commission', async () => {
    const { owner, s1, order, svc } = await setup()
    const svcA = await svc('massage_swedish')
    const d = await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '20:00', [s1.employee.id])])
    await completeVisit(s1.actor, d.visits[0]!.id)
    const input = { method: 'tabby', amountHalalas: 19600, reference: 'TBY-1', idempotencyKey: 'provider-event-123' }
    const results = await Promise.all([recordPayment(owner.actor, d.order.id, input), recordPayment(owner.actor, d.order.id, input), recordPayment(owner.actor, d.order.id, input)])
    expect(new Set(results.map((r) => r.id)).size).toBe(1)
    expect(await getDb().select().from(payments).where(eq(payments.orderId, d.order.id))).toHaveLength(1)
    expect(sumFor(await entries(d.order.id), s1.employee.id)).toBe(500)
  })

  it('specialists record cash/POS only on their own orders; a transfer photo/record is not payment until approved', async () => {
    const { mod, s1, s2, order, svc } = await setup()
    const svcA = await svc('massage_swedish')
    const d = await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '20:00', [s1.employee.id])])
    await expect(recordPayment(s2.actor, d.order.id, { method: 'cash', amountHalalas: 100 })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(recordPayment(s1.actor, d.order.id, { method: 'bank_transfer', amountHalalas: 100 })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(recordPayment(s1.actor, d.order.id, { method: 'pos', amountHalalas: 100 })).rejects.toMatchObject({ fieldErrors: { reference: 'required' } })
    await expect(recordPayment(mod.actor, d.order.id, { method: 'tamara', amountHalalas: 100, reference: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    const t = await recordPayment(mod.actor, d.order.id, { method: 'bank_transfer', amountHalalas: 1000, reference: 'photo' })
    expect(t.status).toBe('pending')
  })

  it('payments cannot be edited or deleted in the database', async () => {
    const { s1, order, svc } = await setup()
    const svcA = await svc('massage_swedish')
    const d = await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '20:00', [s1.employee.id])])
    await recordPayment(s1.actor, d.order.id, { method: 'cash', amountHalalas: 1000 })
    await expect(getDb().execute(sql`UPDATE payments SET amount_halalas = 1`)).rejects.toThrow()
    await expect(getDb().execute(sql`DELETE FROM payments`)).rejects.toThrow()
  })
})

describe('cash custody (acceptance #15)', () => {
  it('handover moves custody without creating revenue; differences need a reason', async () => {
    const { owner, s1, order, svc } = await setup()
    const svcA = await svc('massage_swedish')
    const d = await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '20:00', [s1.employee.id])])
    await recordPayment(s1.actor, d.order.id, { method: 'cash', amountHalalas: 19600 })
    expect((await myCustody(s1.actor)).totalHalalas).toBe(19600)
    const before = await orderBalance(getDb(), d.order.id)
    await expect(receiveHandover(owner.actor, s1.employee.id, 19000, null)).rejects.toMatchObject({ fieldErrors: { reason: 'difference_reason_required' } })
    const h = await receiveHandover(owner.actor, s1.employee.id, 19000, 'نقص 6 ريال')
    expect(h.expectedHalalas - h.actualHalalas).toBe(600)
    expect((await myCustody(s1.actor)).totalHalalas).toBe(0)
    expect(await orderBalance(getDb(), d.order.id)).toEqual(before)
    expect(await custodySummary(owner.actor)).toEqual([])
    await expect(receiveHandover(owner.actor, s1.employee.id, 0, null)).rejects.toMatchObject({ code: 'no_cash_in_custody' })
    await expect(custodySummary(s1.actor)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('commissions end-to-end (spec §10)', () => {
  it('acceptance #12: nothing earned before execution AND full payment', async () => {
    const { owner, s1, order, svc } = await setup()
    const svcA = await svc('massage_swedish')
    const d = await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '20:00', [s1.employee.id])])
    await recordPayment(owner.actor, d.order.id, { method: 'cash', amountHalalas: 19600 })
    expect(await entries(d.order.id)).toHaveLength(0) // paid, not executed
    const d2 = await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '22:00', [s1.employee.id])])
    await completeVisit(s1.actor, d2.visits[0]!.id)
    await recordPayment(owner.actor, d2.order.id, { method: 'cash', amountHalalas: 10000 })
    expect(await entries(d2.order.id)).toHaveLength(0) // executed, partly paid
    await completeVisit(s1.actor, d.visits[0]!.id)
    expect(sumFor(await entries(d.order.id), s1.employee.id)).toBe(500)
  })

  it('acceptance #9: four services by one specialist → 15; moderator gets her tier once', async () => {
    const { owner, mod, s1, order, svc } = await setup()
    const codes = ['massage_swedish', 'wax_face_feet', 'skin_classic_facial', 'lashes_weekly']
    const lines = await Promise.all(codes.map(async (c) => ({ kind: 'service', serviceId: (await svc(c)).id, beneficiaryIndex: 1, visitIndex: 0 })))
    const d = await order(lines, [visit('2026-10-01', '20:00', [s1.employee.id], 150)])
    await completeVisit(s1.actor, d.visits[0]!.id)
    await recordPayment(owner.actor, d.order.id, { method: 'cash', amountHalalas: d.order.grandTotalHalalas })
    await completeVisit(s1.actor, d.visits[0]!.id) // repeat: no double
    const rows = await entries(d.order.id)
    expect(sumFor(rows, s1.employee.id)).toBe(1500)
    // 196+96+96+196 = 584 → tier 10 SAR, once.
    expect(rows.filter((r) => r.kind === 'moderator')).toEqual([expect.objectContaining({ employeeId: mod.employee.id, amountHalalas: 1000 })])
  })

  it('acceptance #10: package shared by two → 5 each, nothing for its components', async () => {
    const { owner, s1, s2, order, pkg } = await setup()
    const p = await pkg('pkg_complete_relaxation')
    const d = await order([{ kind: 'package', packageId: p.id, visitIndexes: [0] }], [visit('2026-10-01', '20:00', [s1.employee.id, s2.employee.id])])
    await completeVisit(s2.actor, d.visits[0]!.id)
    await recordPayment(owner.actor, d.order.id, { method: 'pos', amountHalalas: d.order.grandTotalHalalas, reference: 'POS-1' })
    const rows = await entries(d.order.id)
    expect(sumFor(rows, s1.employee.id)).toBe(500)
    expect(sumFor(rows, s2.employee.id)).toBe(500)
  })

  it('acceptance #11: two-visit package → 5 per executing specialist; order value and moderator commission not doubled', async () => {
    const { owner, mod, s1, s2, order, pkg } = await setup()
    const p = await pkg('pkg_swedish_2')
    const d = await order([{ kind: 'package', packageId: p.id, visitIndexes: [0, 1] }], [visit('2026-10-01', '20:00', [s1.employee.id]), visit('2026-10-08', '20:00', [s2.employee.id])])
    expect(d.order.grandTotalHalalas).toBe(49600)
    await recordPayment(owner.actor, d.order.id, { method: 'cash', amountHalalas: 49600 })
    await completeVisit(s1.actor, d.visits[0]!.id)
    let rows = await entries(d.order.id)
    expect(sumFor(rows, s1.employee.id)).toBe(500)
    expect(rows.filter((r) => r.kind === 'moderator')).toHaveLength(0) // not fully executed yet
    await completeVisit(s2.actor, d.visits[1]!.id)
    rows = await entries(d.order.id)
    expect(sumFor(rows, s2.employee.id)).toBe(500)
    expect(rows.filter((r) => r.kind !== 'moderator').reduce((a, r) => a + r.amountHalalas, 0)).toBe(1000)
    expect(rows.filter((r) => r.kind === 'moderator')).toEqual([expect.objectContaining({ employeeId: mod.employee.id, amountHalalas: 0 + 0 + 500 })]) // 496 → tier 5
  })

  it('acceptance #3: a specialist sees only her own commissions (also via the service)', async () => {
    const { owner, s1, s2, order, svc } = await setup()
    const svcA = await svc('massage_swedish')
    const d = await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '20:00', [s1.employee.id])])
    await completeVisit(s1.actor, d.visits[0]!.id)
    await recordPayment(owner.actor, d.order.id, { method: 'cash', amountHalalas: 19600 })
    expect((await myCommissions(s1.actor)).summary.earnedUnpaid).toBe(500)
    expect((await myCommissions(s2.actor)).summary.earnedUnpaid).toBe(0)
    expect(JSON.stringify(await myCommissions(s2.actor))).not.toContain(s1.employee.id)
    await expect(allCommissions(s1.actor)).rejects.toBeInstanceOf(ForbiddenError)
    const all = await allCommissions(owner.actor)
    expect(all.find((x) => x.employeeId === s1.employee.id)?.earnedUnpaid).toBe(500)
  })

  it('expected commission is shown separately before it is earned', async () => {
    const { mod, s1, order, svc } = await setup()
    const svcA = await svc('massage_swedish')
    await order([{ kind: 'service', serviceId: svcA.id, beneficiaryIndex: 1, visitIndex: 0 }], [visit('2026-10-01', '20:00', [s1.employee.id])])
    expect((await myCommissions(s1.actor)).summary).toMatchObject({ expected: 500, earnedUnpaid: 0, paid: 0 })
    expect((await myCommissions(mod.actor)).summary.expected).toBe(0) // 196 < 250
  })
})
