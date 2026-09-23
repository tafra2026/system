import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { messageTasks } from '@/server/db/schema'
import {
  confirmMessageSent,
  countDueMessages,
  listMessageTasks,
  markMessageOpened,
  prepareMessage,
  syncMessageTasks,
} from '@/server/services/messages'
import { completeVisit, getOrderDetail, rescheduleVisit, saveOrder } from '@/server/services/orders'
import { recordPayment } from '@/server/services/payments'
import { NotFoundError } from '@/server/services/errors'
import { setSetting } from '@/server/services/settings'
import { markLegStarted, myTrips, saveLeg } from '@/server/services/trips'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist', 'S1')
  const driver = await makeStaff('driver', 'D1')
  const cat = await catalog()
  await setSetting(owner.actor, 'start_point', { label: 'السكن', latitude: 21.59, longitude: 39.14 })
  const book = async (opts: { confirm?: boolean; date?: string; time?: string } = {}) => {
    const { customer, address } = await customerWithAddress(mod.actor)
    const swedish = await cat.svc('massage_swedish')
    const res = await saveOrder(
      mod.actor,
      null,
      { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit(opts.date ?? '2026-10-01', opts.time ?? '20:00', [s1.employee.id])] },
      { confirm: opts.confirm ?? true },
    )
    const detail = await getOrderDetail(mod.actor, res.id)
    return { orderId: res.id, reference: res.reference, visit: detail.visits[0]!, customer }
  }
  return { owner, mod, s1, driver, book }
}

const tasksOf = (orderId: string) => getDb().select().from(messageTasks).where(eq(messageTasks.orderId, orderId))
const open = (rows: Awaited<ReturnType<typeof tasksOf>>, kind: string) => rows.filter((r) => r.kind === kind && (r.status === 'ready' || r.status === 'opened'))

describe('tasks are created by the server (spec §13, §14)', () => {
  it('confirming prepares the confirmation now and a reminder three hours before the visit; drafts get nothing', async () => {
    const { book } = await setup()
    const draft = await book({ confirm: false })
    expect(await tasksOf(draft.orderId)).toHaveLength(0)

    const o = await book()
    const rows = await tasksOf(o.orderId)
    expect(open(rows, 'booking_confirmation')).toHaveLength(1)
    const [reminder] = open(rows, 'visit_reminder')
    expect(reminder!.dueAt).toEqual(new Date('2026-10-01T17:00:00+03:00'))
  })

  it('acceptance #18: rescheduling cancels the old reminder and prepares one for the new time — never duplicates', async () => {
    const { mod, s1, book } = await setup()
    const o = await book()
    const move = { date: '2026-10-02', time: '21:00', durationMinutes: 60, specialistIds: [s1.employee.id] }
    await rescheduleVisit(mod.actor, o.visit.id, move)
    await rescheduleVisit(mod.actor, o.visit.id, move) // same time again: no new task
    await Promise.all([syncMessageTasks(getDb(), o.orderId), getDb().transaction((tx) => syncMessageTasks(tx, o.orderId))])
    const rows = await tasksOf(o.orderId)
    const reminders = rows.filter((r) => r.kind === 'visit_reminder')
    expect(open(rows, 'visit_reminder')).toHaveLength(1)
    expect(open(rows, 'visit_reminder')[0]!.dueAt).toEqual(new Date('2026-10-02T18:00:00+03:00'))
    expect(reminders.filter((r) => r.status === 'cancelled')).toHaveLength(1)
    expect(open(rows, 'booking_confirmation')).toHaveLength(1)
  })

  it('completing the visit cancels its reminder and prepares the review request once the order is done', async () => {
    const { mod, book } = await setup()
    const o = await book()
    await completeVisit(mod.actor, o.visit.id)
    const rows = await tasksOf(o.orderId)
    expect(open(rows, 'visit_reminder')).toHaveLength(0)
    expect(open(rows, 'review_request')).toHaveLength(1)
  })
})

describe('preparing, opening and confirming (acceptance #19)', () => {
  it('text comes from current data; opening is not sending; confirmation is final', async () => {
    const { owner, mod, book } = await setup()
    const o = await book()
    await recordPayment(owner.actor, o.orderId, { method: 'cash', amountHalalas: 5000 })
    const [confirmTask] = open(await tasksOf(o.orderId), 'booking_confirmation')

    const msg = await prepareMessage(mod.actor, confirmTask!.id)
    expect(msg.locale).toBe('ar') // customer message language defaults to Arabic
    expect(msg.text).toContain('عميلة تجربة')
    expect(msg.text).toContain(o.reference)
    expect(msg.text).toContain('50 ر.س') // paid
    expect(msg.link.startsWith(`https://wa.me/${o.customer.phoneE164.slice(1)}?text=`)).toBe(true)

    await markMessageOpened(mod.actor, confirmTask!.id)
    let [row] = await getDb().select().from(messageTasks).where(eq(messageTasks.id, confirmTask!.id))
    expect(row!.status).toBe('opened') // still NOT sent
    expect(row!.sentConfirmedAt).toBeNull()
    expect(await countDueMessages(mod.actor)).toBe(1)

    await confirmMessageSent(mod.actor, confirmTask!.id)
    await confirmMessageSent(mod.actor, confirmTask!.id) // idempotent
    ;[row] = await getDb().select().from(messageTasks).where(eq(messageTasks.id, confirmTask!.id))
    expect(row!.status).toBe('sent')
    expect(row!.sentConfirmedByUserId).toBe(mod.actor.userId)
    expect(await countDueMessages(mod.actor)).toBe(0)
    // History of a confirmed message cannot be rewritten, even directly in the database.
    await expect(getDb().execute(sql`UPDATE message_tasks SET status = 'ready' WHERE id = ${row!.id}`)).rejects.toThrow()
  })

  it('custom wording is used and an empty review link drops its line', async () => {
    const { owner, mod, book } = await setup()
    await setSetting(owner.actor, 'message_templates', { review_request: { ar: 'شكرًا {customer_name}\nقيّمينا: {review_link}' } })
    const o = await book()
    await completeVisit(mod.actor, o.visit.id)
    const [review] = open(await tasksOf(o.orderId), 'review_request')
    expect((await prepareMessage(mod.actor, review!.id)).text).toBe('شكرًا عميلة تجربة')
    await setSetting(owner.actor, 'review_link', 'https://g.page/r/pamperme/review')
    expect((await prepareMessage(mod.actor, review!.id)).text).toBe('شكرًا عميلة تجربة\nقيّمينا: https://g.page/r/pamperme/review')
  })
})

describe('"on the way" and who may see what', () => {
  it('the driver tapping "started" prepares the message for that order, assigned to her; others stay hidden', async () => {
    const { owner, mod, s1, driver, book } = await setup()
    const o = await book()
    const other = await book({ time: '23:00' })
    await saveLeg(mod.actor, o.visit.id, { kind: 'dropoff', driverId: driver.employee.id, originVisitId: null, mode: 'manual', travelMinutes: 20, bufferMinutes: 15 })
    const [leg] = await myTrips(driver.actor, '2026-10-01', '2026-10-01')
    await markLegStarted(driver.actor, leg!.legId)

    const [onway] = open(await tasksOf(o.orderId), 'on_the_way')
    expect(onway!.assigneeEmployeeId).toBe(driver.employee.id)
    expect(onway!.visitId).toBe(o.visit.id)

    // Driver sees only her task; not the confirmations/reminders or other orders.
    const now = new Date('2026-10-01T19:40:00+03:00')
    const visible = await listMessageTasks(driver.actor, 'due', now)
    expect(visible.map((r) => r.id)).toEqual([onway!.id])
    const [otherConfirm] = open(await tasksOf(other.orderId), 'booking_confirmation')
    await expect(prepareMessage(driver.actor, otherConfirm!.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await prepareMessage(driver.actor, onway!.id)).text).toContain('في الطريق')

    // Specialists have no access to customer messages at all.
    await expect(listMessageTasks(s1.actor, 'due')).rejects.toBeInstanceOf(ForbiddenError)

    // Setting: the moderator sends "on the way" instead of the driver.
    await setSetting(owner.actor, 'on_the_way_sender', 'moderator')
    await saveLeg(mod.actor, other.visit.id, { kind: 'dropoff', driverId: driver.employee.id, originVisitId: null, mode: 'manual', travelMinutes: 20, bufferMinutes: 15 })
    const legs = await myTrips(driver.actor, '2026-10-01', '2026-10-01')
    await markLegStarted(driver.actor, legs.find((l) => l.visitId === other.visit.id)!.legId)
    const [onway2] = await getDb().select().from(messageTasks).where(and(eq(messageTasks.orderId, other.orderId), eq(messageTasks.kind, 'on_the_way')))
    expect(onway2!.assigneeEmployeeId).toBe(mod.employee.id)
  })
})
