import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { riyadhToday } from '@/domain/operational-day'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { employeeDaysOff, employees, employeeWeeklyOff, orders, tripLegs, visits, visitSpecialists } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'

export interface EmployeeOff {
  weekly: number[]
  dates: { id: string; date: string; note: string | null }[]
}

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()

/** Days off of one employee (future specific dates only). Management, or the employee herself. */
export async function getEmployeeTimeOff(actor: Actor, employeeId: string): Promise<EmployeeOff> {
  if (employeeId !== actor.employeeId && !can(actor, 'staff.manage')) throw new ForbiddenError('staff.manage')
  const db = getDb()
  const weekly = await db.select().from(employeeWeeklyOff).where(eq(employeeWeeklyOff.employeeId, employeeId))
  const dates = await db
    .select()
    .from(employeeDaysOff)
    .where(and(eq(employeeDaysOff.employeeId, employeeId), isNull(employeeDaysOff.cancelledAt), gte(employeeDaysOff.offDate, riyadhToday())))
    .orderBy(asc(employeeDaysOff.offDate))
  return { weekly: weekly.map((w) => w.weekday).sort(), dates: dates.map((d) => ({ id: d.id, date: d.offDate, note: d.note })) }
}

/** Operational dates (from today, within `days`) on which the employee already has work. */
async function bookedDates(db: Executor, employeeId: string, days = 120): Promise<string[]> {
  const today = riyadhToday()
  const until = new Date(`${today}T00:00:00Z`)
  until.setUTCDate(until.getUTCDate() + days)
  const to = until.toISOString().slice(0, 10)
  const asSpecialist = await db
    .select({ d: visits.operationalDate })
    .from(visitSpecialists)
    .innerJoin(visits, eq(visits.id, visitSpecialists.visitId))
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .where(and(eq(visitSpecialists.employeeId, employeeId), eq(visitSpecialists.blocking, true), eq(visits.status, 'scheduled'), gte(visits.operationalDate, today), lte(visits.operationalDate, to)))
  const asDriver = await db
    .select({ d: visits.operationalDate })
    .from(tripLegs)
    .innerJoin(visits, eq(visits.id, tripLegs.visitId))
    .where(and(eq(tripLegs.driverEmployeeId, employeeId), eq(tripLegs.blocking, true), eq(visits.status, 'scheduled'), gte(visits.operationalDate, today), lte(visits.operationalDate, to)))
  return [...new Set([...asSpecialist, ...asDriver].map((r) => r.d!).filter(Boolean))].sort()
}

async function lockEmployee(tx: Executor, employeeId: string) {
  if (!z.uuid().safeParse(employeeId).success) throw new NotFoundError()
  const [e] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for('update')
  if (!e) throw new NotFoundError()
  return e
}

/**
 * Weekly days off. Refused while the employee has booked work on an affected day —
 * those visits/trips must be moved first (nothing is changed silently).
 */
export async function setWeeklyOff(actor: Actor, employeeId: string, weekdays: number[]) {
  authorize(actor, 'staff.manage')
  const days = [...new Set(weekdays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort()
  await getDb().transaction(async (tx) => {
    await lockEmployee(tx, employeeId)
    const before = (await tx.select().from(employeeWeeklyOff).where(eq(employeeWeeklyOff.employeeId, employeeId))).map((w) => w.weekday).sort()
    const added = days.filter((d) => !before.includes(d))
    const clashes = (await bookedDates(tx, employeeId)).filter((d) => added.includes(weekdayOf(d)))
    if (clashes.length) throw new ValidationError('employee_has_bookings', { dates: clashes.slice(0, 5).join('، ') })
    await tx.delete(employeeWeeklyOff).where(eq(employeeWeeklyOff.employeeId, employeeId))
    if (days.length) await tx.insert(employeeWeeklyOff).values(days.map((weekday) => ({ employeeId, weekday, createdByUserId: actor.userId })))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'timeoff.weekly', entityType: 'employee', entityId: employeeId, before: { weekdays: before }, after: { weekdays: days } })
  })
}

export async function addDayOff(actor: Actor, employeeId: string, date: string, note: string | null) {
  authorize(actor, 'staff.manage')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new ValidationError('validation_failed', { date: 'invalid' })
  if (date < riyadhToday()) throw new ValidationError('validation_failed', { date: 'day_off_past' })
  await getDb().transaction(async (tx) => {
    await lockEmployee(tx, employeeId)
    if ((await bookedDates(tx, employeeId)).includes(date)) throw new ValidationError('employee_has_bookings', { dates: date })
    const [existing] = await tx.select().from(employeeDaysOff).where(and(eq(employeeDaysOff.employeeId, employeeId), eq(employeeDaysOff.offDate, date), isNull(employeeDaysOff.cancelledAt)))
    if (existing) return
    await tx.insert(employeeDaysOff).values({ employeeId, offDate: date, note: note?.trim().slice(0, 300) || null, createdByUserId: actor.userId })
    await writeAudit(tx, { actorUserId: actor.userId, action: 'timeoff.add', entityType: 'employee', entityId: employeeId, after: { date } })
  })
}

export async function cancelDayOff(actor: Actor, dayOffId: string) {
  authorize(actor, 'staff.manage')
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(employeeDaysOff).where(eq(employeeDaysOff.id, dayOffId)).for('update')
    if (!row) throw new NotFoundError()
    if (row.cancelledAt) return
    await tx.update(employeeDaysOff).set({ cancelledAt: new Date() }).where(eq(employeeDaysOff.id, dayOffId))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'timeoff.cancel', entityType: 'employee', entityId: row.employeeId, before: { date: row.offDate } })
  })
}

/** Which of these employees are off on an operational date. */
export async function employeesOffOn(db: Executor, employeeIds: string[], date: string): Promise<Set<string>> {
  if (!employeeIds.length) return new Set()
  const weekly = await db.select().from(employeeWeeklyOff).where(and(inArray(employeeWeeklyOff.employeeId, employeeIds), eq(employeeWeeklyOff.weekday, weekdayOf(date))))
  const dated = await db.select().from(employeeDaysOff).where(and(inArray(employeeDaysOff.employeeId, employeeIds), eq(employeeDaysOff.offDate, date), isNull(employeeDaysOff.cancelledAt)))
  return new Set([...weekly.map((w) => w.employeeId), ...dated.map((d) => d.employeeId)])
}

/** Days off for many employees in a window (for the booking screen to grey out choices). */
export async function offCalendar(db: Executor, employeeIds: string[], from: string, to: string): Promise<Record<string, { weekly: number[]; dates: string[] }>> {
  const out: Record<string, { weekly: number[]; dates: string[] }> = {}
  for (const id of employeeIds) out[id] = { weekly: [], dates: [] }
  if (!employeeIds.length) return out
  for (const w of await db.select().from(employeeWeeklyOff).where(inArray(employeeWeeklyOff.employeeId, employeeIds))) out[w.employeeId]!.weekly.push(w.weekday)
  const dated = await db
    .select()
    .from(employeeDaysOff)
    .where(and(inArray(employeeDaysOff.employeeId, employeeIds), isNull(employeeDaysOff.cancelledAt), gte(employeeDaysOff.offDate, from), lte(employeeDaysOff.offDate, to)))
  for (const d of dated) out[d.employeeId]!.dates.push(d.offDate)
  return out
}
