import { describe, expect, it } from 'vitest'
import { moderatorCommission, moderatorEarned, specialistCommissions, type CommissionUnit } from '@/domain/commission'
import { orderTotals } from '@/domain/pricing'
import { sar } from '@/domain/money'

const svc = (id: string, specialistId: string, executed = true): CommissionUnit => ({
  kind: 'service',
  id,
  specialistId,
  executed,
})
const byId = (rows: ReturnType<typeof specialistCommissions>) =>
  Object.fromEntries(rows.map((r) => [r.specialistId, r]))

describe('moderator commission (spec §10)', () => {
  it('acceptance #7: tiers at the boundaries', () => {
    const cases: [number, number][] = [
      [249.99, 0],
      [250, 5],
      [499.99, 5],
      [500, 10],
      [1000, 10],
      [1000.01, 40],
    ]
    for (const [total, expected] of cases) expect(moderatorCommission(sar(total))).toBe(sar(expected))
  })

  it('acceptance #8: delivery fee does not move the order to a higher tier', () => {
    const totals = orderTotals([sar(240)], sar(30))
    expect(totals.grandTotal).toBe(sar(270))
    expect(moderatorCommission(totals.servicesTotal)).toBe(0)
  })

  it('is earned only when the order is fully executed and paid', () => {
    expect(moderatorEarned(sar(600), { orderFullyExecuted: true, orderFullyPaid: false }).earned).toBe(0)
    expect(moderatorEarned(sar(600), { orderFullyExecuted: false, orderFullyPaid: true }).earned).toBe(0)
    expect(moderatorEarned(sar(600), { orderFullyExecuted: true, orderFullyPaid: true }).earned).toBe(sar(10))
  })
})

describe('specialist commission (spec §10)', () => {
  it('5 per unit: 2 → 10, 3 → 15', () => {
    expect(byId(specialistCommissions([svc('a', 'S1'), svc('b', 'S1')], { orderFullyPaid: true })).S1!.earned).toBe(sar(10))
    expect(
      byId(specialistCommissions([svc('a', 'S1'), svc('b', 'S1'), svc('c', 'S1')], { orderFullyPaid: true })).S1!.earned,
    ).toBe(sar(15))
  })

  it('acceptance #9: four services → 15 only', () => {
    const units = ['a', 'b', 'c', 'd'].map((id) => svc(id, 'S1'))
    const r = byId(specialistCommissions(units, { orderFullyPaid: true }))
    expect(r.S1!.expected).toBe(sar(15))
    expect(r.S1!.earned).toBe(sar(15))
  })

  it('cap is per specialist, not shared', () => {
    const units = ['a', 'b', 'c', 'd'].map((id) => svc(id, 'S1')).concat(['e', 'f', 'g'].map((id) => svc(id, 'S2')))
    const r = byId(specialistCommissions(units, { orderFullyPaid: true }))
    expect(r.S1!.earned).toBe(sar(15))
    expect(r.S2!.earned).toBe(sar(15))
  })

  it('package by one specialist → 10', () => {
    const pkg: CommissionUnit = { kind: 'package', id: 'p', visits: [{ visitId: 'v1', specialistIds: ['S1'], executed: true }] }
    expect(byId(specialistCommissions([pkg], { orderFullyPaid: true })).S1!.earned).toBe(sar(10))
  })

  it('acceptance #10: package shared by two → 5 each, no extra for its components', () => {
    const pkg: CommissionUnit = {
      kind: 'package',
      id: 'p',
      visits: [{ visitId: 'v1', specialistIds: ['S1', 'S2'], executed: true }],
    }
    const r = byId(specialistCommissions([pkg], { orderFullyPaid: true }))
    expect(r.S1!.earned).toBe(sar(5))
    expect(r.S2!.earned).toBe(sar(5))
    expect(r.S1!.shares).toHaveLength(1)
  })

  it('acceptance #11 (commission part): two-visit package → 5 per executing specialist, total ≤ 10', () => {
    const pkg: CommissionUnit = {
      kind: 'package',
      id: 'p',
      visits: [
        { visitId: 'v1', specialistIds: ['S1'], executed: true },
        { visitId: 'v2', specialistIds: ['S2'], executed: true },
      ],
    }
    const rows = specialistCommissions([pkg], { orderFullyPaid: true })
    const r = byId(rows)
    expect(r.S1!.earned).toBe(sar(5))
    expect(r.S2!.earned).toBe(sar(5))
    expect(rows.reduce((a, x) => a + x.earned, 0)).toBe(sar(10))
    // Same specialist on both visits still gets 10 in total.
    const same: CommissionUnit = {
      kind: 'package',
      id: 'p',
      visits: [
        { visitId: 'v1', specialistIds: ['S1'], executed: true },
        { visitId: 'v2', specialistIds: ['S1'], executed: true },
      ],
    }
    expect(byId(specialistCommissions([same], { orderFullyPaid: true })).S1!.earned).toBe(sar(10))
  })

  it('cap 15 spans all visits of the original order', () => {
    const pkg: CommissionUnit = {
      kind: 'package',
      id: 'p',
      visits: [
        { visitId: 'v1', specialistIds: ['S1'], executed: true },
        { visitId: 'v2', specialistIds: ['S1'], executed: true },
      ],
    }
    const r = byId(specialistCommissions([pkg, svc('a', 'S1'), svc('b', 'S1')], { orderFullyPaid: true }))
    expect(r.S1!.expected).toBe(sar(15))
    expect(r.S1!.earned).toBe(sar(15))
  })

  it('acceptance #12: nothing earned for unexecuted service or unpaid order', () => {
    const units = [svc('a', 'S1', true), svc('b', 'S1', false)]
    const paid = byId(specialistCommissions(units, { orderFullyPaid: true }))
    expect(paid.S1!.expected).toBe(sar(10))
    expect(paid.S1!.earned).toBe(sar(5))
    const unpaid = byId(specialistCommissions(units, { orderFullyPaid: false }))
    expect(unpaid.S1!.earned).toBe(0)
  })
})
