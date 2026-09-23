import { splitEvenly, type Halalas } from './money'

/**
 * Revenue recognition per visit (spec §15): a service's final price belongs to the visit it is
 * done in; a package's final price is split EQUALLY across its session visits (rounding
 * remainder on the first session); the delivery fee belongs to the first visit. Collections
 * are never revenue by themselves — revenue is recognised when a visit is executed.
 */
export interface RevenueLine {
  final: Halalas
  /** Visit ids in session order (one for services). */
  visitIds: string[]
}

export function allocateOrderRevenue(lines: readonly RevenueLine[], deliveryFee: Halalas, firstVisitId: string | null): Map<string, Halalas> {
  const out = new Map<string, Halalas>()
  const add = (id: string, v: Halalas) => out.set(id, (out.get(id) ?? 0) + v)
  for (const l of lines) {
    if (!l.visitIds.length) continue
    const parts = splitEvenly(l.final, l.visitIds.length)
    l.visitIds.forEach((id, i) => add(id, parts[i]!))
  }
  if (deliveryFee > 0 && firstVisitId) add(firstVisitId, deliveryFee)
  return out
}

/** Growth percentage, or null when the comparison base is zero (no misleading %). */
export function growth(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}
