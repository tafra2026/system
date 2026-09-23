import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { mapsLink } from '@/domain/order'
import { legTimes, validateBuffer, validateTravelMinutes, type LegKind } from '@/domain/trips'
import { authorize, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { customerAddresses, customers, employees, orders, tripLegs, visits, visitSpecialists } from '../db/schema'
import { computeTravelMinutes, mapsConfigured } from '../integrations/google-routes'
import { NotFoundError, ValidationError } from './errors'
import { getSetting } from './settings'
import { teamsOn } from './teams'
import { syncLegsForVisit } from './trip-sync'
import { syncMessageTasks } from './messages'
import { notifyVisitChanges, visitPeople } from './notifications'
import { employeesOffOn } from './time-off'
import { parseWith, pgConstraint, pgErrorCode } from './validation'

interface Point {
  label: string
  latitude: number | null
  longitude: number | null
}
interface AddressSnap {
  label?: string | null
  district: string
  addressLine?: string | null
  latitude: number | null
  longitude: number | null
}

const nameOf = (e: { fullName: string; displayNameEn: string | null }, locale: 'ar' | 'en') => (locale === 'en' && e.displayNameEn ? e.displayNameEn : e.fullName)

function conflict(err: unknown): never {
  if (pgErrorCode(err) === '23P01') {
    const c = pgConstraint(err)
    throw new ValidationError(c === 'visit_specialists_no_overlap' ? 'specialist_conflict' : 'driver_conflict')
  }
  throw err
}

async function loadVisit(db: Executor, visitId: string) {
  if (!z.uuid().safeParse(visitId).success) throw new NotFoundError()
  const [row] = await db.select({ v: visits, o: orders }).from(visits).innerJoin(orders, eq(orders.id, visits.orderId)).where(eq(visits.id, visitId))
  if (!row) throw new NotFoundError()
  return row
}

/** Origin of a leg: another visit's location, or the configured start point. */
async function resolveOrigin(db: Executor, visitDate: string, originVisitId: string | null): Promise<{ point: Point; originVisitId: string | null }> {
  if (!originVisitId) {
    const start = await getSetting(db, 'start_point')
    if (!start) throw new ValidationError('start_point_missing')
    return { point: { label: start.label, latitude: start.latitude, longitude: start.longitude }, originVisitId: null }
  }
  const o = await loadVisit(db, originVisitId)
  if (o.v.operationalDate !== visitDate) throw new ValidationError('validation_failed', { originVisitId: 'invalid' })
  const a = o.o.addressSnapshot as AddressSnap | null
  return { point: { label: `${o.o.reference} — ${a?.district ?? ''}`, latitude: a?.latitude ?? null, longitude: a?.longitude ?? null }, originVisitId }
}

// ─────────────────────────────── Day plan ───────────────────────────────

export async function dayPlan(actor: Actor, date: string) {
  authorize(actor, 'schedule.manage')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('validation_failed', { date: 'invalid' })
  const db = getDb()
  const rows = await db
    .select({ v: visits, o: orders, customerName: customers.name, photoFileId: customerAddresses.photoFileId })
    .from(visits)
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(customerAddresses, eq(customerAddresses.id, orders.addressId))
    .where(and(eq(visits.operationalDate, date), inArray(orders.status, ['confirmed', 'completed', 'pending_review']), inArray(visits.status, ['scheduled', 'completed'])))
    .orderBy(asc(visits.startsAt))
  const ids = rows.map((r) => r.v.id)
  const specs = ids.length
    ? await db
        .select({ visitId: visitSpecialists.visitId, id: employees.id, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
        .from(visitSpecialists)
        .innerJoin(employees, eq(employees.id, visitSpecialists.employeeId))
        .where(inArray(visitSpecialists.visitId, ids))
    : []
  const legs = ids.length ? await db.select().from(tripLegs).where(inArray(tripLegs.visitId, ids)) : []
  const driverRows = await db.select().from(employees).where(and(eq(employees.role, 'driver'), eq(employees.status, 'active'))).orderBy(asc(employees.createdAt))
  const teamOf = await teamsOn(db, [...new Set([...specs.map((s) => s.id), ...driverRows.map((d) => d.id)])], date)
  const off = await employeesOffOn(db, [...new Set([...specs.map((s) => s.id), ...driverRows.map((d) => d.id)])], date)
  const drivers = driverRows.filter((d) => !off.has(d.id)).map((d) => ({ id: d.id, name: nameOf(d, actor.locale), teamId: teamOf.get(d.id) ?? null }))
  const driverNames = new Map(driverRows.map((d) => [d.id, nameOf(d, actor.locale)]))

  // Who works today (spec follow-up: not every specialist works every day).
  const crewRows = await db.select().from(employees).where(and(inArray(employees.role, ['driver', 'specialist']), eq(employees.status, 'active'))).orderBy(asc(employees.createdAt))
  const crewOff = await employeesOffOn(db, crewRows.map((e) => e.id), date)
  const roster = crewRows.map((e) => ({ id: e.id, name: nameOf(e, actor.locale), role: e.role, working: !crewOff.has(e.id) }))

  return {
    date,
    roster,
    mapsConfigured: mapsConfigured(),
    startPoint: await getSetting(db, 'start_point'),
    defaultBuffer: await getSetting(db, 'default_buffer_minutes'),
    drivers,
    visits: rows.map((r) => {
      const address = r.o.addressSnapshot as AddressSnap | null
      const specialists = specs.filter((s) => s.visitId === r.v.id).map((s) => ({ id: s.id, name: nameOf(s, actor.locale) }))
      const teamIds = specialists.map((s) => teamOf.get(s.id)).filter(Boolean)
      const suggested = drivers.find((d) => d.teamId && teamIds.includes(d.teamId))?.id ?? (drivers.length === 1 ? drivers[0]!.id : null)
      return {
        visitId: r.v.id,
        orderId: r.o.id,
        reference: r.o.reference,
        customerName: r.customerName,
        status: r.v.status,
        startsAt: r.v.startsAt!,
        endsAt: new Date(r.v.startsAt!.getTime() + r.v.durationMinutes * 60_000),
        address,
        hasCoords: address?.latitude != null && address?.longitude != null,
        buildingPhotoUrl: r.photoFileId ? `/api/files/${r.photoFileId}` : null,
        specialists,
        suggestedDriverId: suggested,
        legs: legs
          .filter((l) => l.visitId === r.v.id)
          .map((l) => ({ ...l, driverName: driverNames.get(l.driverEmployeeId) ?? '', origin: l.originSnapshot as Point })),
      }
    }),
  }
}

// ─────────────────────────────── Legs ───────────────────────────────

const legInputSchema = z.object({
  kind: z.enum(['dropoff', 'pickup']),
  driverId: z.uuid(),
  originVisitId: z.uuid().nullable().default(null),
  mode: z.enum(['google', 'manual']),
  travelMinutes: z.number().int().nullable().default(null),
  bufferMinutes: z.number().int(),
})

/**
 * Estimate travel time with Google Maps for a planned leg. Never throws for map failures:
 * the caller shows "not calculated" and offers a manual estimate.
 */
export async function estimateLegTravel(actor: Actor, visitId: string, kind: LegKind, originVisitId: string | null) {
  authorize(actor, 'schedule.manage')
  const db = getDb()
  const { v, o } = await loadVisit(db, visitId)
  if (!v.startsAt || !v.operationalDate) throw new ValidationError('visit_not_scheduled')
  const dest = o.addressSnapshot as AddressSnap | null
  const { point } = await resolveOrigin(db, v.operationalDate, originVisitId)
  if (point.latitude == null || point.longitude == null || dest?.latitude == null || dest?.longitude == null) {
    return { ok: false as const, reason: 'coords_missing' as const }
  }
  const arrive = kind === 'dropoff' ? v.startsAt : new Date(v.startsAt.getTime() + v.durationMinutes * 60_000)
  // Departure estimate for traffic: arrival minus a typical hour.
  return computeTravelMinutes({ latitude: point.latitude, longitude: point.longitude }, { latitude: dest.latitude, longitude: dest.longitude }, new Date(arrive.getTime() - 60 * 60_000))
}

/** Plan (or re-plan) a leg. Google mode computes on the server; manual mode stores the staff estimate. */
export async function saveLeg(actor: Actor, visitId: string, raw: unknown) {
  authorize(actor, 'schedule.manage')
  const input = parseWith(legInputSchema, raw)
  const db = getDb()
  const { v, o } = await loadVisit(db, visitId)
  if (o.status === 'draft') throw new ValidationError('order_is_draft')
  if (v.status !== 'scheduled' || !v.startsAt || !v.operationalDate) throw new ValidationError('visit_not_scheduled')
  const [driver] = await db.select().from(employees).where(eq(employees.id, input.driverId))
  if (!driver || driver.role !== 'driver' || driver.status !== 'active') throw new ValidationError('validation_failed', { driverId: 'driver_invalid' })
  if ((await employeesOffOn(db, [driver.id], v.operationalDate)).size > 0) throw new ValidationError('validation_failed', { driverId: 'driver_day_off' })
  const origin = await resolveOrigin(db, v.operationalDate, input.originVisitId)

  let travelMinutes: number
  if (input.mode === 'google') {
    const r = await estimateLegTravel(actor, visitId, input.kind, input.originVisitId)
    if (!r.ok) throw new ValidationError(r.reason === 'coords_missing' ? 'coords_missing' : 'maps_unavailable')
    travelMinutes = r.minutes
  } else {
    if (input.travelMinutes == null) throw new ValidationError('validation_failed', { travelMinutes: 'required' })
    travelMinutes = input.travelMinutes
  }
  let times: { departAt: Date; arriveAt: Date }
  try {
    validateTravelMinutes(travelMinutes)
    validateBuffer(input.bufferMinutes)
    times = legTimes({ kind: input.kind, visitStart: v.startsAt, visitDurationMinutes: v.durationMinutes, travelMinutes, bufferMinutes: input.bufferMinutes })
  } catch (err) {
    if (err instanceof DomainError) throw new ValidationError('validation_failed', { [err.code === 'buffer_out_of_range' ? 'bufferMinutes' : 'travelMinutes']: err.code })
    throw err
  }

  try {
    await db.transaction(async (tx) => {
      const peopleBefore = await visitPeople(tx, visitId)
      const values = {
        driverEmployeeId: driver.id,
        originVisitId: origin.originVisitId,
        originSnapshot: origin.point,
        travelMinutes,
        travelSource: input.mode,
        bufferMinutes: input.bufferMinutes,
        ...times,
        blocking: true,
        updatedAt: new Date(),
      }
      await tx
        .insert(tripLegs)
        .values({ visitId, kind: input.kind, ...values, createdByUserId: actor.userId })
        .onConflictDoUpdate({ target: [tripLegs.visitId, tripLegs.kind], set: { ...values, startedAt: null } })
      await syncLegsForVisit(tx, visitId)
      await syncMessageTasks(tx, o.id)
      await notifyVisitChanges(tx, visitId, peopleBefore, actor.userId)
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: 'trip.leg_saved',
        entityType: 'order',
        entityId: o.id,
        after: { visit: v.sequence, kind: input.kind, driver: driver.id, travelMinutes, source: input.mode, buffer: input.bufferMinutes },
      })
    })
  } catch (err) {
    conflict(err)
  }
  return { travelMinutes, ...times }
}

export async function removeLeg(actor: Actor, visitId: string, kind: LegKind) {
  authorize(actor, 'schedule.manage')
  await getDb().transaction(async (tx) => {
    const [leg] = await tx.select().from(tripLegs).where(and(eq(tripLegs.visitId, visitId), eq(tripLegs.kind, kind)))
    if (!leg) return
    const peopleBefore = await visitPeople(tx, visitId)
    await tx.delete(tripLegs).where(eq(tripLegs.id, leg.id))
    // Specialists go back to being reserved from the visit start.
    const [v] = await tx.select().from(visits).where(eq(visits.id, visitId))
    if (v?.startsAt) await tx.update(visitSpecialists).set({ startsAt: v.startsAt }).where(and(eq(visitSpecialists.visitId, visitId), eq(visitSpecialists.blocking, true)))
    await syncLegsForVisit(tx, visitId)
    if (v) await syncMessageTasks(tx, v.orderId)
    await notifyVisitChanges(tx, visitId, peopleBefore, actor.userId)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'trip.leg_removed', entityType: 'visit', entityId: visitId, after: { kind } })
  })
}

// ─────────────────────────────── Driver view ───────────────────────────────

/** A driver's own legs: times, places, the specialists to carry. No prices, no phone numbers. */
export async function myTrips(actor: Actor, fromDate: string, toDate: string) {
  authorize(actor, 'schedule.read.own')
  if (actor.role !== 'driver') throw new ForbiddenError('schedule.read.own')
  const db = getDb()
  const rows = await db
    .select({ l: tripLegs, v: visits, o: orders, customerName: customers.name, photoFileId: customerAddresses.photoFileId })
    .from(tripLegs)
    .innerJoin(visits, eq(visits.id, tripLegs.visitId))
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(customerAddresses, eq(customerAddresses.id, orders.addressId))
    .where(and(eq(tripLegs.driverEmployeeId, actor.employeeId), eq(tripLegs.blocking, true), gte(visits.operationalDate, fromDate), lte(visits.operationalDate, toDate)))
    .orderBy(asc(tripLegs.departAt))
  const ids = [...new Set(rows.map((r) => r.v.id))]
  const specs = ids.length
    ? await db
        .select({ visitId: visitSpecialists.visitId, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
        .from(visitSpecialists)
        .innerJoin(employees, eq(employees.id, visitSpecialists.employeeId))
        .where(inArray(visitSpecialists.visitId, ids))
    : []
  return rows.map((r) => {
    const a = r.o.addressSnapshot as AddressSnap | null
    const origin = r.l.originSnapshot as Point
    return {
      legId: r.l.id,
      visitId: r.v.id,
      kind: r.l.kind,
      departAt: r.l.departAt,
      arriveAt: r.l.arriveAt,
      travelMinutes: r.l.travelMinutes,
      bufferMinutes: r.l.bufferMinutes,
      travelSource: r.l.travelSource,
      startedAt: r.l.startedAt,
      reference: r.o.reference,
      customerName: r.customerName,
      destination: a
        ? { district: a.district, addressLine: a.addressLine ?? null, mapUrl: a.latitude != null && a.longitude != null ? mapsLink(a.latitude, a.longitude) : null, photoUrl: r.photoFileId ? `/api/files/${r.photoFileId}` : null }
        : null,
      origin: { label: origin.label, mapUrl: origin.latitude != null && origin.longitude != null ? mapsLink(origin.latitude, origin.longitude) : null },
      specialists: specs.filter((s) => s.visitId === r.v.id).map((s) => nameOf(s, actor.locale)),
    }
  })
}

/**
 * Driver taps "I started heading to the customer". Records the time once (idempotent).
 * This also prepares the WhatsApp "on the way" message.
 */
export async function markLegStarted(actor: Actor, legId: string) {
  authorize(actor, 'schedule.read.own')
  await getDb().transaction(async (tx) => {
    const [leg] = await tx.select().from(tripLegs).where(eq(tripLegs.id, legId)).for('update')
    if (!leg) throw new NotFoundError()
    if (leg.driverEmployeeId !== actor.employeeId) throw new ForbiddenError('schedule.read.own')
    if (leg.startedAt) return
    await tx.update(tripLegs).set({ startedAt: new Date() }).where(eq(tripLegs.id, legId))
    // Prepares the "on the way" message for this order and destination (spec §13).
    const [v] = await tx.select({ orderId: visits.orderId }).from(visits).where(eq(visits.id, leg.visitId))
    if (v) await syncMessageTasks(tx, v.orderId)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'trip.leg_started', entityType: 'visit', entityId: leg.visitId, after: { kind: leg.kind } })
  })
}

// ─────────────────────────────── Calendar ───────────────────────────────

/** Visits (and legs) between two operational dates, for the day and week calendar. */
export async function calendarRange(actor: Actor, fromDate: string, toDate: string) {
  authorize(actor, 'orders.read.all')
  const db = getDb()
  const rows = await db
    .select({ v: visits, o: orders, customerName: customers.name })
    .from(visits)
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(gte(visits.operationalDate, fromDate), lte(visits.operationalDate, toDate), inArray(orders.status, ['confirmed', 'completed', 'pending_review'])))
    .orderBy(asc(visits.startsAt))
  const ids = rows.map((r) => r.v.id)
  const specs = ids.length
    ? await db
        .select({ visitId: visitSpecialists.visitId, id: employees.id, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
        .from(visitSpecialists)
        .innerJoin(employees, eq(employees.id, visitSpecialists.employeeId))
        .where(inArray(visitSpecialists.visitId, ids))
    : []
  const legs = ids.length
    ? await db
        .select({ l: tripLegs, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
        .from(tripLegs)
        .innerJoin(employees, eq(employees.id, tripLegs.driverEmployeeId))
        .where(and(inArray(tripLegs.visitId, ids), eq(tripLegs.blocking, true)))
    : []
  return rows.map((r) => ({
    visitId: r.v.id,
    orderId: r.o.id,
    reference: r.o.reference,
    customerName: r.customerName,
    status: r.v.status,
    operationalDate: r.v.operationalDate!,
    startsAt: r.v.startsAt!,
    durationMinutes: r.v.durationMinutes,
    district: (r.o.addressSnapshot as AddressSnap | null)?.district ?? null,
    specialists: specs.filter((s) => s.visitId === r.v.id).map((s) => ({ id: s.id, name: nameOf(s, actor.locale) })),
    legs: legs.filter((l) => l.l.visitId === r.v.id).map((l) => ({ kind: l.l.kind, departAt: l.l.departAt, arriveAt: l.l.arriveAt, driverName: nameOf(l, actor.locale) })),
  }))
}
