import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { riyadhToday, addDays } from '@/domain/operational-day'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { teamMembers, visitSpecialists } from '@/server/db/schema'
import { getOrderDetail, markVisitPendingReview, rescheduleVisit, saveOrder } from '@/server/services/orders'
import { setSetting } from '@/server/services/settings'
import { createTeam, listTeams, myTeam, setTeamMembership, teamsOn } from '@/server/services/teams'
import { dayPlan, markLegStarted, myTrips, saveLeg } from '@/server/services/trips'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist', 'S1')
  const s2 = await makeStaff('specialist', 'S2')
  const driver = await makeStaff('driver', 'D1')
  const cat = await catalog()
  await setSetting(owner.actor, 'start_point', { label: 'المقر', latitude: 21.55, longitude: 39.17 })
  const book = async (time: string, specialistId: string, date = '2026-10-01') => {
    const { customer, address } = await customerWithAddress(mod.actor)
    const swedish = await cat.svc('massage_swedish')
    const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit(date, time, [specialistId])] }, { confirm: true })
    return (await getOrderDetail(mod.actor, res.id)).visits[0]!
  }
  return { owner, mod, s1, s2, driver, book, ...cat }
}
const manual = (driverId: string, travelMinutes: number, kind: 'dropoff' | 'pickup' = 'dropoff', bufferMinutes = 15, originVisitId: string | null = null) => ({ kind, driverId, originVisitId, mode: 'manual', travelMinutes, bufferMinutes })

describe('teams are effective-dated (acceptance #20, team part)', () => {
  it('moving a specialist does not rewrite earlier days; backdating is refused; history is protected', async () => {
    const { owner, s1 } = await setup()
    const a = await createTeam(owner.actor, 'فريق أ')
    const b = await createTeam(owner.actor, 'فريق ب')
    const today = riyadhToday()
    await setTeamMembership(owner.actor, s1.employee.id, a.id, today)
    await setTeamMembership(owner.actor, s1.employee.id, b.id, addDays(today, 10))
    const db = getDb()
    expect((await teamsOn(db, [s1.employee.id], addDays(today, 9))).get(s1.employee.id)).toBe(a.id)
    expect((await teamsOn(db, [s1.employee.id], addDays(today, 10))).get(s1.employee.id)).toBe(b.id)
    await expect(setTeamMembership(owner.actor, s1.employee.id, a.id, addDays(today, -1))).rejects.toMatchObject({ fieldErrors: { effectiveFrom: 'team_backdated' } })
    await expect(db.execute(sql`UPDATE team_members SET team_id = ${b.id}`)).rejects.toThrow()
    await expect(db.delete(teamMembers)).rejects.toThrow()
    const teamsNow = await listTeams(owner.actor, today)
    expect(teamsNow.find((t) => t.id === a.id)!.members.map((m) => m.employeeId)).toEqual([s1.employee.id])
  })

  it('a driver can have all four specialists; members see their own team only', async () => {
    const { owner, s1, s2, driver } = await setup()
    const t = await createTeam(owner.actor, 'الفريق الحالي')
    for (const e of [driver, s1, s2]) await setTeamMembership(owner.actor, e.employee.id, t.id, riyadhToday())
    const mine = await myTeam(driver.actor)
    expect(mine!.members.map((m) => m.name).sort()).toEqual(['S1', 'S2'])
    await expect(myTeam((await makeStaff('moderator')).actor)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('driving legs and availability (spec §5, §11)', () => {
  it('a dropoff leg reserves the driver and extends the specialists’ window by travel + buffer', async () => {
    const { mod, s1, driver, book } = await setup()
    const v = await book('20:00', s1.employee.id)
    const leg = await saveLeg(mod.actor, v.id, manual(driver.employee.id, 20))
    expect((v.startsAt!.getTime() - leg.departAt.getTime()) / 60_000).toBe(35)
    const [block] = await getDb().select().from(visitSpecialists).where(eq(visitSpecialists.visitId, v.id))
    expect(block!.startsAt).toEqual(leg.departAt)
  })

  it('acceptance #16 (driver part): overlapping legs for one driver are refused, also concurrently', async () => {
    const { mod, s1, s2, driver, book } = await setup()
    const a = await book('20:00', s1.employee.id)
    const b = await book('20:10', s2.employee.id)
    await saveLeg(mod.actor, a.id, manual(driver.employee.id, 20))
    await expect(saveLeg(mod.actor, b.id, manual(driver.employee.id, 20))).rejects.toMatchObject({ code: 'driver_conflict' })

    const c = await book('22:00', s1.employee.id)
    const d = await book('22:05', s2.employee.id)
    const results = await Promise.allSettled([saveLeg(mod.actor, c.id, manual(driver.employee.id, 20)), saveLeg(mod.actor, d.id, manual(driver.employee.id, 20))])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('travel time counts for the specialist: a too-close next visit is refused', async () => {
    const { mod, s1, driver, book } = await setup()
    await book('20:00', s1.employee.id) // 20:00–21:00
    const next = await book('21:15', s1.employee.id) // fits without travel
    const other = await makeStaff('driver', 'D2')
    // With 20 min travel + 15 buffer she would have to leave at 20:40 — still in her previous visit.
    await expect(saveLeg(mod.actor, next.id, manual(other.employee.id, 20))).rejects.toMatchObject({ code: 'specialist_conflict' })
    expect(driver).toBeTruthy()
  })

  it('rescheduling moves the legs; pending review releases the driver', async () => {
    const { mod, s1, s2, driver, book } = await setup()
    const a = await book('20:00', s1.employee.id)
    await saveLeg(mod.actor, a.id, manual(driver.employee.id, 20))
    await rescheduleVisit(mod.actor, a.id, { date: '2026-10-01', time: '22:00', durationMinutes: 60, specialistIds: [s1.employee.id] })
    const plan = await dayPlan(mod.actor, '2026-10-01')
    const leg = plan.visits.find((x) => x.visitId === a.id)!.legs[0]!
    expect(leg.arriveAt.toISOString()).toBe('2026-10-01T19:00:00.000Z')
    const b = await book('21:50', s2.employee.id)
    await expect(saveLeg(mod.actor, b.id, manual(driver.employee.id, 10, 'dropoff', 10))).rejects.toMatchObject({ code: 'driver_conflict' })
    await markVisitPendingReview(mod.actor, a.id, 'تعذر')
    await expect(saveLeg(mod.actor, b.id, manual(driver.employee.id, 10, 'dropoff', 10))).resolves.toBeTruthy()
  })

  it('Google mode without a configured key reports maps_unavailable (manual estimate stays possible)', async () => {
    const { mod, s1, driver, book } = await setup()
    const v = await book('20:00', s1.employee.id)
    await expect(saveLeg(mod.actor, v.id, { kind: 'dropoff', driverId: driver.employee.id, mode: 'google', bufferMinutes: 15 })).rejects.toMatchObject({ code: 'maps_unavailable' })
    await expect(saveLeg(mod.actor, v.id, manual(driver.employee.id, 20, 'dropoff', 16))).rejects.toMatchObject({ fieldErrors: { bufferMinutes: 'buffer_out_of_range' } })
  })

  it('without a start point the leg must start from another visit', async () => {
    const { owner, mod, s1, driver, book } = await setup()
    await setSetting(owner.actor, 'start_point', null)
    const v = await book('20:00', s1.employee.id)
    await expect(saveLeg(mod.actor, v.id, manual(driver.employee.id, 20))).rejects.toMatchObject({ code: 'start_point_missing' })
  })

  it('days off block booking', async () => {
    const { owner, s1, book } = await setup()
    await setSetting(owner.actor, 'days_off', ['2026-10-01'])
    await expect(book('20:00', s1.employee.id)).rejects.toMatchObject({ fieldErrors: { 'visits.0': 'day_off' } })
  })
})

describe('driver view', () => {
  it('shows own legs with places and specialists, no prices; start is recorded once', async () => {
    const { mod, s1, driver, book } = await setup()
    const v = await book('20:00', s1.employee.id)
    await saveLeg(mod.actor, v.id, manual(driver.employee.id, 20))
    await saveLeg(mod.actor, v.id, manual(driver.employee.id, 20, 'pickup'))
    const trips = await myTrips(driver.actor, '2026-10-01', '2026-10-01')
    expect(trips.map((t) => t.kind)).toEqual(['dropoff', 'pickup'])
    expect(trips[0]!.specialists).toEqual(['S1'])
    expect(trips[0]!.destination?.mapUrl).toContain('google.com/maps')
    expect(JSON.stringify(trips)).not.toMatch(/Halalas|price|phone/i)
    await markLegStarted(driver.actor, trips[0]!.legId)
    const first = (await myTrips(driver.actor, '2026-10-01', '2026-10-01'))[0]!.startedAt
    await markLegStarted(driver.actor, trips[0]!.legId)
    expect((await myTrips(driver.actor, '2026-10-01', '2026-10-01'))[0]!.startedAt).toEqual(first)
    const other = await makeStaff('driver', 'D2')
    await expect(markLegStarted(other.actor, trips[0]!.legId)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(myTrips(s1.actor, '2026-10-01', '2026-10-01')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(dayPlan(driver.actor, '2026-10-01')).rejects.toBeInstanceOf(ForbiddenError)
  })
})
