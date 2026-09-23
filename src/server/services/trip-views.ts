import type { DriverLeg } from '@/components/trips-list'
import type { myTrips } from './trips'

/** Serialize driver legs for the client component. */
export function toDriverLegs(rows: Awaited<ReturnType<typeof myTrips>>): DriverLeg[] {
  return rows.map((r) => ({
    legId: r.legId,
    kind: r.kind,
    departAt: r.departAt.toISOString(),
    arriveAt: r.arriveAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    reference: r.reference,
    customerName: r.customerName,
    destination: r.destination,
    origin: r.origin,
    specialists: r.specialists,
  }))
}
