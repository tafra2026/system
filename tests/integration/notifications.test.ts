import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '@/server/db'
import { notifications, pushSubscriptions } from '@/server/db/schema'
import { savePushSubscription, useMockPushTransportForTests, type PushTarget } from '@/server/push'
import { NotFoundError, ValidationError } from '@/server/services/errors'
import { markAllNotificationsRead, myNotifications, openNotification, unreadNotificationCount } from '@/server/services/notifications'
import { getOrderDetail, rescheduleVisit, saveOrder } from '@/server/services/orders'
import { decideTransfer, recordPayment } from '@/server/services/payments'
import { setSetting } from '@/server/services/settings'
import { saveLeg } from '@/server/services/trips'
import { runWorkerTick } from '@/server/worker'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterEach(() => useMockPushTransportForTests(null))
afterAll(closeDb)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist', 'S1')
  const s2 = await makeStaff('specialist', 'S2')
  const driver = await makeStaff('driver', 'D1')
  const cat = await catalog()
  await setSetting(owner.actor, 'start_point', { label: 'السكن', latitude: 21.59, longitude: 39.14 })
  const { customer, address } = await customerWithAddress(mod.actor)
  const swedish = await cat.svc('massage_swedish')
  const res = await saveOrder(
    mod.actor,
    null,
    { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] },
    { confirm: true },
  )
  const detail = await getOrderDetail(mod.actor, res.id)
  return { owner, mod, s1, s2, driver, orderId: res.id, reference: res.reference, visitId: detail.visits[0]!.id, customer }
}

const kindsFor = async (userId: string) => (await getDb().select().from(notifications).where(eq(notifications.userId, userId))).map((n) => n.kind).sort()

describe('who is told what (spec §14)', () => {
  it('booking, specialist swap, time change and driver assignment notify only the people concerned', async () => {
    const { mod, s1, s2, driver, visitId, reference } = await setup()
    expect(await kindsFor(s1.user.id)).toEqual(['visit_assigned'])
    expect(await kindsFor(mod.user.id)).toEqual([]) // the person making the change is not notified

    // Specialist is English by default: the text is in her language, with no customer details.
    const [n] = await myNotifications(s1.actor)
    expect(n!.title).toBe('New booking for you')
    expect(n!.body).toContain(reference)
    expect(n!.body).not.toMatch(/[؀-ۿ]/)

    await rescheduleVisit(mod.actor, visitId, { date: '2026-10-01', time: '21:00', durationMinutes: 60, specialistIds: [s2.employee.id] })
    expect(await kindsFor(s1.user.id)).toEqual(['visit_assigned', 'visit_unassigned'])
    expect(await kindsFor(s2.user.id)).toEqual(['visit_assigned'])

    await rescheduleVisit(mod.actor, visitId, { date: '2026-10-01', time: '22:00', durationMinutes: 60, specialistIds: [s2.employee.id] })
    expect(await kindsFor(s2.user.id)).toEqual(['visit_assigned', 'visit_rescheduled'])

    await saveLeg(mod.actor, visitId, { kind: 'dropoff', driverId: driver.employee.id, originVisitId: null, mode: 'manual', travelMinutes: 20, bufferMinutes: 15 })
    expect(await kindsFor(driver.user.id)).toEqual(['trip_assigned'])
    // Re-planning the same leg with the same driver does not notify again.
    await saveLeg(mod.actor, visitId, { kind: 'dropoff', driverId: driver.employee.id, originVisitId: null, mode: 'manual', travelMinutes: 25, bufferMinutes: 15 })
    expect(await kindsFor(driver.user.id)).toEqual(['trip_assigned'])
  })

  it('a pending transfer alerts management; the decision alerts whoever recorded it', async () => {
    const { owner, mod, orderId } = await setup()
    const p = await recordPayment(mod.actor, orderId, { method: 'bank_transfer', amountHalalas: 5000, reference: 'TRX-7' })
    expect(await kindsFor(owner.user.id)).toEqual(['transfer_pending'])
    await decideTransfer(owner.actor, p.id, false, 'لم يصل')
    expect(await kindsFor(mod.user.id)).toEqual(['payment_rejected'])
  })

  it('the centre is private: read state, counts, and no access to other people’s notifications', async () => {
    const { mod, s1 } = await setup()
    expect(await unreadNotificationCount(s1.actor)).toBe(1)
    const [n] = await myNotifications(s1.actor)
    await expect(openNotification(mod.actor, n!.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await openNotification(s1.actor, n!.id)).toBe('/schedule')
    expect(await unreadNotificationCount(s1.actor)).toBe(0)
    await markAllNotificationsRead(s1.actor)
  })
})

describe('background worker: due messages and Web Push', () => {
  it('announces each due WhatsApp task once, to the order’s moderator, and not stale ones', async () => {
    const { mod } = await setup()
    // The booking confirmation is due now; the reminder at 17:00 on the visit day.
    await runWorkerTick(new Date())
    expect(await kindsFor(mod.user.id)).toEqual(['message_due'])
    await runWorkerTick(new Date('2026-10-01T17:01:00+03:00'))
    await runWorkerTick(new Date('2026-10-01T17:02:00+03:00'))
    expect(await kindsFor(mod.user.id)).toEqual(['message_due', 'message_due'])
    const texts = (await myNotifications(mod.actor)).map((n) => n.body)
    expect(texts.some((b) => b.startsWith('تذكير قبل الموعد'))).toBe(true)
  })

  it('pushes to the recipient’s devices in her language without customer data; dead devices are removed', async () => {
    const { s1, customer } = await setup()
    const sent: { target: PushTarget; payload: string }[] = []
    // Development mock — nothing leaves the test process.
    useMockPushTransportForTests(async (target, payload) => {
      sent.push({ target, payload })
      return target.endpoint.includes('gone') ? { ok: false, gone: true } : { ok: true }
    })
    await savePushSubscription(s1.actor, { endpoint: 'https://push.example.test/ok', keys: { p256dh: 'BPk3', auth: 'a1' }, deviceLabel: 'Android' })
    await savePushSubscription(s1.actor, { endpoint: 'https://push.example.test/gone', keys: { p256dh: 'BPk4', auth: 'a2' } })
    await runWorkerTick(new Date())

    expect(sent).toHaveLength(2)
    const payload = JSON.parse(sent[0]!.payload) as { title: string; body: string; url: string; lang: string }
    expect(payload).toMatchObject({ title: 'New booking for you', url: '/schedule', lang: 'en' })
    for (const s of sent) {
      expect(s.payload).not.toContain(customer.name)
      expect(s.payload).not.toContain(customer.phoneE164)
    }
    const [n] = await getDb().select().from(notifications).where(eq(notifications.userId, s1.user.id))
    expect(n!.pushState).toBe('sent')
    const devices = await getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, s1.user.id))
    expect(devices.map((d) => d.endpoint)).toEqual(['https://push.example.test/ok'])

    // Nothing is pushed twice.
    await runWorkerTick(new Date())
    expect(sent).toHaveLength(2)
  })

  it('without server keys push is simply off; subscriptions must be valid https endpoints', async () => {
    const { s1 } = await setup()
    const saved = process.env.VAPID_PRIVATE_KEY
    delete process.env.VAPID_PRIVATE_KEY
    try {
      await runWorkerTick(new Date())
    } finally {
      if (saved !== undefined) process.env.VAPID_PRIVATE_KEY = saved
    }
    const [n] = await getDb().select().from(notifications).where(and(eq(notifications.userId, s1.user.id), eq(notifications.kind, 'visit_assigned')))
    expect(n!.pushState).toBe('disabled')
    await expect(savePushSubscription(s1.actor, { endpoint: 'http://insecure.test/x', keys: { p256dh: 'a', auth: 'b' } })).rejects.toBeInstanceOf(ValidationError)
  })
})
