import type { DriverLeg } from '@/components/trips-list'
import type { myTrips } from './trips'

/** Serialize driver legs for the client component. */
export function toDriverLegs(
  rows: Awaited<ReturnType<typeof myTrips>>,
  onTheWay: Map<string, { id: string; status: 'ready' | 'opened' | 'sent' | 'cancelled' }> = new Map(),
): DriverLeg[] {
  return rows.map((r) => ({
    messageTask: r.kind === 'dropoff' ? (onTheWay.get(r.visitId) ?? null) : null,
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
