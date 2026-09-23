import { and, eq } from 'drizzle-orm'
import { legTimes } from '@/domain/trips'
import type { Executor } from '../db'
import { tripLegs, visits, visitSpecialists } from '../db/schema'

/**
 * Re-derive a visit's leg times and the specialists' reserved window after the visit
 * changed. Specialists ride with the driver, so with a dropoff leg they are reserved from
 * its departure until the visit ends. Visits under review release everyone.
 */
export async function syncLegsForVisit(tx: Executor, visitId: string): Promise<void> {
  const [v] = await tx.select().from(visits).where(eq(visits.id, visitId))
  if (!v) return
  const legs = await tx.select().from(tripLegs).where(eq(tripLegs.visitId, visitId))
  const active = v.status === 'scheduled' || v.status === 'completed'
  let specialistsFrom = v.startsAt
  for (const leg of legs) {
    if (!v.startsAt || !active) {
      await tx.update(tripLegs).set({ blocking: false, updatedAt: new Date() }).where(eq(tripLegs.id, leg.id))
      continue
    }
    const times = legTimes({ kind: leg.kind, visitStart: v.startsAt, visitDurationMinutes: v.durationMinutes, travelMinutes: leg.travelMinutes, bufferMinutes: leg.bufferMinutes })
    await tx.update(tripLegs).set({ ...times, blocking: true, updatedAt: new Date() }).where(eq(tripLegs.id, leg.id))
    if (leg.kind === 'dropoff') specialistsFrom = times.departAt
  }
  if (v.startsAt && active) {
    const endsAt = new Date(v.startsAt.getTime() + v.durationMinutes * 60_000)
    await tx
      .update(visitSpecialists)
      .set({ startsAt: specialistsFrom, endsAt })
      .where(and(eq(visitSpecialists.visitId, visitId), eq(visitSpecialists.blocking, true)))
  }
}
