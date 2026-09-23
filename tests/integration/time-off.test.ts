import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { addDays, riyadhToday } from '@/domain/operational-day'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb } from '@/server/db'
import { getOrderDetail, rescheduleVisit, saveOrder } from '@/server/services/orders'
import { setSetting } from '@/server/services/settings'
import { addDayOff, cancelDayOff, getEmployeeTimeOff, setWeeklyOff } from '@/server/services/time-off'
import { dayPlan, saveLeg } from '@/server/services/trips'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

const future = (n: number) => addDays(riyadhToday(), n)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist', 'S1')
  const s2 = await makeStaff('specialist', 'S2')
  const driver = await makeStaff('driver', 'D1')
  const cat = await catalog()
  await setSetting(owner.actor, 'start_point', { label: 'سكن الأخصائيات', latitude: 21.55, longitude: 39.17 })
  const book = async (date: string, specialistId: string, time = '20:00') => {
    const { customer, address } = await customerWithAddress(mod.actor)
    const swedish = await cat.svc('massage_swedish')
    const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit(date, time, [specialistId])] }, { confirm: true })
    return (await getOrderDetail(mod.actor, res.id)).visits[0]!
  }
  return { owner, mod, s1, s2, driver, book }
}

describe('per-employee days off (set by management)', () => {
  it('a specialist on a day off cannot be booked; others can (not all four every day)', async () => {
    const { owner, s1, s2, book } = await setup()
    const d = future(5)
    await addDayOff(owner.actor, s1.employee.id, d, 'إجازة')
    await expect(book(d, s1.employee.id)).rejects.toMatchObject({ fieldErrors: { 'visits.0': 'specialist_day_off' } })
    await expect(book(d, s2.employee.id)).resolves.toBeTruthy()
    // After midnight still counts for the same operational day.
    await expect(book(addDays(d, 1), s1.employee.id, '01:00')).rejects.toMatchObject({ fieldErrors: { 'visits.0': 'specialist_day_off' } })
  })

  it('weekly day off blocks booking and rescheduling onto that weekday', async () => {
    const { owner, mod, s1, book } = await setup()
    const d = future(7)
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay()
    await setWeeklyOff(owner.actor, s1.employee.id, [weekday])
    await expect(book(d, s1.employee.id)).rejects.toMatchObject({ fieldErrors: { 'visits.0': 'specialist_day_off' } })
    const v = await book(future(8), s1.employee.id)
    await expect(rescheduleVisit(mod.actor, v.id, { date: d, time: '20:00', durationMinutes: 60, specialistIds: [s1.employee.id] })).rejects.toMatchObject({ fieldErrors: { specialistIds: 'specialist_day_off' } })
  })

  it('cannot add a day off on a day with existing work; nothing is changed silently', async () => {
    const { owner, s1, book } = await setup()
    const d = future(3)
    await book(d, s1.employee.id)
    await expect(addDayOff(owner.actor, s1.employee.id, d, null)).rejects.toMatchObject({ code: 'employee_has_bookings' })
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay()
    await expect(setWeeklyOff(owner.actor, s1.employee.id, [weekday])).rejects.toMatchObject({ code: 'employee_has_bookings' })
    await expect(addDayOff(owner.actor, s1.employee.id, addDays(riyadhToday(), -1), null)).rejects.toMatchObject({ fieldErrors: { date: 'day_off_past' } })
  })

  it('a driver on a day off cannot get trips; the planner shows who works that day', async () => {
    const { owner, mod, s1, driver, book } = await setup()
    const d = future(4)
    const v = await book(d, s1.employee.id)
    await addDayOff(owner.actor, driver.employee.id, future(6), null)
    const v2 = await book(future(6), s1.employee.id)
    await expect(saveLeg(mod.actor, v2.id, { kind: 'dropoff', driverId: driver.employee.id, mode: 'manual', travelMinutes: 20, bufferMinutes: 15 })).rejects.toMatchObject({ fieldErrors: { driverId: 'driver_day_off' } })
    await expect(saveLeg(mod.actor, v.id, { kind: 'dropoff', driverId: driver.employee.id, mode: 'manual', travelMinutes: 20, bufferMinutes: 15 })).resolves.toBeTruthy()
    const plan = await dayPlan(mod.actor, future(6))
    expect(plan.roster.find((r) => r.id === driver.employee.id)?.working).toBe(false)
    expect(plan.drivers.find((x) => x.id === driver.employee.id)).toBeUndefined()
  })

  it('only management sets days off; employees can see their own', async () => {
    const { owner, mod, s1 } = await setup()
    const d = future(9)
    await expect(addDayOff(mod.actor, s1.employee.id, d, null)).rejects.toBeInstanceOf(ForbiddenError)
    await addDayOff(owner.actor, s1.employee.id, d, null)
    const mine = await getEmployeeTimeOff(s1.actor, s1.employee.id)
    expect(mine.dates.map((x) => x.date)).toEqual([d])
    await expect(getEmployeeTimeOff(s1.actor, mod.employee.id)).rejects.toBeInstanceOf(ForbiddenError)
    await cancelDayOff(owner.actor, mine.dates[0]!.id)
    expect((await getEmployeeTimeOff(owner.actor, s1.employee.id)).dates).toEqual([])
  })
})
