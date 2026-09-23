import { DomainError } from './errors'
import { splitEvenly, sum, type Halalas } from './money'

/**
 * Commission rule set. A copy of the rule set (with its version) is stored on each
 * order so later rule changes never rewrite old orders (spec §10).
 */
export interface CommissionRules {
  version: string
  /** Per standalone service unit executed by the specialist herself. */
  specialistPerServiceUnit: Halalas
  /** Cap per specialist per ORIGINAL order, across all its visits. */
  specialistCapPerOrder: Halalas
  /** Total specialist commission for one package, split across visits then specialists. */
  packagePool: Halalas
  /** Moderator tiers on final services total (after discounts, excluding delivery). */
  moderatorTiers: readonly ModeratorTier[]
}

export interface ModeratorTier {
  /** Inclusive lower bound. */
  min: Halalas
  /** Upper bound (null = unbounded). */
  max: Halalas | null
  maxInclusive: boolean
  amount: Halalas
}

export const COMMISSION_RULES_V1: CommissionRules = {
  version: 'v1',
  specialistPerServiceUnit: 500,
  specialistCapPerOrder: 1500,
  packagePool: 1000,
  moderatorTiers: [
    { min: 0, max: 25000, maxInclusive: false, amount: 0 },
    { min: 25000, max: 50000, maxInclusive: false, amount: 500 },
    { min: 50000, max: 100000, maxInclusive: true, amount: 1000 },
    { min: 100001, max: null, maxInclusive: false, amount: 4000 },
  ],
}

/** One moderator commission per original order, never per visit/package/payment. */
export function moderatorCommission(servicesFinalTotal: Halalas, rules: CommissionRules = COMMISSION_RULES_V1): Halalas {
  if (!Number.isSafeInteger(servicesFinalTotal) || servicesFinalTotal < 0) throw new DomainError('money_invalid')
  for (const t of rules.moderatorTiers) {
    const aboveMin = servicesFinalTotal >= t.min
    const belowMax = t.max == null || (t.maxInclusive ? servicesFinalTotal <= t.max : servicesFinalTotal < t.max)
    if (aboveMin && belowMax) return t.amount
  }
  throw new DomainError('commission_tier_missing')
}

/** A standalone service unit (quantity is expanded into separate units by the caller). */
export interface ServiceUnit {
  kind: 'service'
  id: string
  /** The specialist who executed / is assigned to execute this unit. */
  specialistId: string | null
  executed: boolean
}

/** A package sold once in the order; its visits may be on different dates. */
export interface PackageUnit {
  kind: 'package'
  id: string
  visits: readonly { visitId: string; specialistIds: readonly string[]; executed: boolean }[]
}

export type CommissionUnit = ServiceUnit | PackageUnit

export interface CommissionShare {
  unitId: string
  visitId: string | null
  amount: Halalas
  executed: boolean
}

export interface SpecialistCommission {
  specialistId: string
  /** Everything assigned to her in the order, capped. */
  expected: Halalas
  /** Executed shares, capped — only when the order is fully paid; otherwise 0. */
  earned: Halalas
  shares: CommissionShare[]
}

/**
 * Specialist commissions for ONE original order.
 * - Standalone service: fixed amount per unit to the executing specialist.
 * - Package: pool split evenly across its visits, then evenly across the specialists of
 *   each visit (1 visit/1 specialist → 10; 1 visit/2 → 5 + 5; 2 visits → 5 per visit).
 *   Package components never earn service commission on top.
 * - Cap applied per specialist on the order total (not renewed per visit).
 */
export function specialistCommissions(
  units: readonly CommissionUnit[],
  opts: { orderFullyPaid: boolean },
  rules: CommissionRules = COMMISSION_RULES_V1,
): SpecialistCommission[] {
  const shares = new Map<string, CommissionShare[]>()
  const add = (specialistId: string, share: CommissionShare) => {
    const list = shares.get(specialistId) ?? []
    list.push(share)
    shares.set(specialistId, list)
  }

  for (const unit of units) {
    if (unit.kind === 'service') {
      if (!unit.specialistId) continue
      add(unit.specialistId, { unitId: unit.id, visitId: null, amount: rules.specialistPerServiceUnit, executed: unit.executed })
      continue
    }
    if (unit.visits.length === 0) continue
    const perVisit = splitEvenly(rules.packagePool, unit.visits.length)
    unit.visits.forEach((visit, i) => {
      const specialists = [...new Set(visit.specialistIds)]
      if (specialists.length === 0) return
      const perSpecialist = splitEvenly(perVisit[i]!, specialists.length)
      specialists.forEach((sid, j) =>
        add(sid, { unitId: unit.id, visitId: visit.visitId, amount: perSpecialist[j]!, executed: visit.executed }),
      )
    })
  }

  const cap = rules.specialistCapPerOrder
  return [...shares.entries()].map(([specialistId, list]) => {
    const expected = Math.min(cap, sum(list.map((s) => s.amount)))
    const executed = Math.min(cap, sum(list.filter((s) => s.executed).map((s) => s.amount)))
    return { specialistId, expected, earned: opts.orderFullyPaid ? executed : 0, shares: list }
  })
}

/** Moderator commission is earned only once the whole order is executed AND fully paid. */
export function moderatorEarned(
  servicesFinalTotal: Halalas,
  opts: { orderFullyExecuted: boolean; orderFullyPaid: boolean },
  rules: CommissionRules = COMMISSION_RULES_V1,
): { expected: Halalas; earned: Halalas } {
  const expected = moderatorCommission(servicesFinalTotal, rules)
  return { expected, earned: opts.orderFullyExecuted && opts.orderFullyPaid ? expected : 0 }
}
