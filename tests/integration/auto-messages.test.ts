import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '@/server/db'
import { messageTasks, orders } from '@/server/db/schema'
import { useMockUltraMsgTransportForTests, type UltraMsgTransport } from '@/server/integrations/ultramsg'
import { AUTO_MAX_ATTEMPTS, autoSendDueMessages, saveAutoWhatsappSettings, sendAutoTestMessage } from '@/server/services/auto-messages'
import { markMessageOpened, prepareMessage } from '@/server/services/messages'
import { createDueMessageNotifications } from '@/server/services/notifications'
import { getOrderDetail, saveOrder } from '@/server/services/orders'
import { ForbiddenError } from '@/server/authz/errors'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

/**
 * DEVELOPMENT MOCK — nothing here contacts UltraMsg or WhatsApp. The mock transport records
 * what would have been sent and answers like UltraMsg does.
 */
type Call = { url: string; form: URLSearchParams }
let calls: Call[] = []
function mockAnswer(answer: (n: number) => { status: number; body: string } | 'timeout') {
  const transport: UltraMsgTransport = async (url, init) => {
    calls.push({ url, form: new URLSearchParams(init.body) })
    const a = answer(calls.length)
    if (a === 'timeout') {
      const err = new Error('aborted')
      await new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(err))
      })
    }
    const r = a as { status: number; body: string }
    return { status: r.status, text: async () => r.body }
  }
  useMockUltraMsgTransportForTests(transport)
}
const OK = () => ({ status: 200, body: JSON.stringify({ sent: 'true', message: 'ok', id: 77 }) })

beforeEach(async () => {
  await resetDb()
  calls = []
  process.env.ULTRAMSG_INSTANCE_ID = 'instance1'
  process.env.ULTRAMSG_TOKEN = 'test-token'
  mockAnswer(OK)
})
afterEach(() => {
  useMockUltraMsgTransportForTests(null)
  delete process.env.ULTRAMSG_INSTANCE_ID
  delete process.env.ULTRAMSG_TOKEN
})
afterAll(closeDb)

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist', 'S1')
  const cat = await catalog()
  const book = async (time = '20:00') => {
    const { customer, address } = await customerWithAddress(mod.actor)
    const swedish = await cat.svc('massage_swedish')
    const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-12-01', time, [s1.employee.id])] }, { confirm: true })
    await getOrderDetail(mod.actor, res.id)
    return { orderId: res.id, customer }
  }
  return { owner, mod, book }
}
const confirmation = async (orderId: string) =>
  (await getDb().select().from(messageTasks).where(eq(messageTasks.orderId, orderId))).find((t) => t.kind === 'booking_confirmation')!
const pass = (now = new Date()) => autoSendDueMessages(now, { gapMs: 0 })

describe('automatic WhatsApp sending (D81, development mock only)', () => {
  it('is off by default and only management can switch it on', async () => {
    const { owner, mod, book } = await setup()
    const o = await book()
    expect(await pass()).toEqual({ sent: 0, failed: 0, uncertain: 0 })
    expect(calls).toHaveLength(0)
    await expect(saveAutoWhatsappSettings(mod.actor, { enabled: true, kinds: ['booking_confirmation'] })).rejects.toBeInstanceOf(ForbiddenError)
    // Switching on does not send messages that became due before.
    await saveAutoWhatsappSettings(owner.actor, { enabled: true, kinds: ['booking_confirmation'] })
    await pass()
    expect(calls).toHaveLength(0)
    expect((await confirmation(o.orderId)).status).toBe('ready')
  })

  it('sends a new confirmation once, marks it sent, and never sends it again', async () => {
    const { owner, book } = await setup()
    await saveAutoWhatsappSettings(owner.actor, { enabled: true, kinds: ['booking_confirmation'] })
    const o = await book()
    const [a, b] = await Promise.all([pass(), pass()])
    expect(a.sent + b.sent).toBe(1)
    await pass()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.ultramsg.com/instance1/messages/chat')
    expect(calls[0]!.form.get('to')).toBe(o.customer.phoneE164)
    expect(calls[0]!.form.get('body')).toContain('عميلة تجربة')
    const t = await confirmation(o.orderId)
    expect(t).toMatchObject({ status: 'sent', autoState: 'sent', autoProviderId: '77', sentConfirmedByUserId: null })
    // Only the enabled type: the reminder (not due yet anyway) is untouched.
  })

  it('test orders, and tasks a person already opened, are never sent automatically', async () => {
    const { owner, mod, book } = await setup()
    await saveAutoWhatsappSettings(owner.actor, { enabled: true, kinds: ['booking_confirmation'] })
    const test = await book()
    await getDb().update(orders).set({ isTest: true }).where(eq(orders.id, test.orderId))
    const opened = await book('23:00')
    await markMessageOpened(mod.actor, (await confirmation(opened.orderId)).id)
    await pass()
    expect(calls).toHaveLength(0)
  })

  it('a refused message is retried with a pause, then handed back to staff with a notification', async () => {
    const { owner, book } = await setup()
    mockAnswer(() => ({ status: 200, body: JSON.stringify({ error: 'instance not connected' }) }))
    await saveAutoWhatsappSettings(owner.actor, { enabled: true, kinds: ['booking_confirmation'] })
    const o = await book()
    let now = new Date()
    await pass(now)
    let t = await confirmation(o.orderId)
    expect(t).toMatchObject({ autoState: 'failed', autoAttempts: 1, status: 'ready' })
    expect(t.autoError).toContain('instance not connected')
    // Staff are not told while the system is still retrying.
    expect(await getDb().transaction((tx) => createDueMessageNotifications(tx, now))).toBe(0)
    await pass(now) // too early for the retry
    expect(calls).toHaveLength(1)
    for (let i = 1; i < AUTO_MAX_ATTEMPTS; i++) {
      now = new Date(now.getTime() + 10 * 60_000)
      await pass(now)
    }
    t = await confirmation(o.orderId)
    expect(t).toMatchObject({ autoState: 'gave_up', autoAttempts: AUTO_MAX_ATTEMPTS, status: 'ready', notifiedAt: null })
    expect(calls).toHaveLength(AUTO_MAX_ATTEMPTS)
    await pass(new Date(now.getTime() + 3600_000))
    expect(calls).toHaveLength(AUTO_MAX_ATTEMPTS)
    expect(await getDb().transaction((tx) => createDueMessageNotifications(tx, now))).toBeGreaterThan(0)
  })

  it('"maybe sent" (timeout) is never retried automatically, and manual sending waits while a send is in progress', async () => {
    const { owner, mod, book } = await setup()
    mockAnswer(() => 'timeout')
    await saveAutoWhatsappSettings(owner.actor, { enabled: true, kinds: ['booking_confirmation'] })
    const o = await book()
    // Simulate a send in progress: the manual buttons refuse.
    await getDb().update(messageTasks).set({ autoState: 'sending' }).where(eq(messageTasks.id, (await confirmation(o.orderId)).id))
    await expect(prepareMessage(mod.actor, (await confirmation(o.orderId)).id)).rejects.toMatchObject({ code: 'message_auto_sending' })
    await getDb().update(messageTasks).set({ autoState: null }).where(eq(messageTasks.id, (await confirmation(o.orderId)).id))
    // Short timeout so the test is quick.
    const { sendWhatsAppText } = await import('@/server/integrations/ultramsg')
    expect(await sendWhatsAppText('+966500000000', 'x', 'r', 50)).toMatchObject({ ok: false, code: 'unknown' })
    calls = []
    await getDb().update(messageTasks).set({ autoState: 'uncertain', autoError: 'timeout' }).where(eq(messageTasks.id, (await confirmation(o.orderId)).id))
    await pass(new Date(Date.now() + 3600_000))
    expect(calls).toHaveLength(0)
    // Staff can still send it by hand after checking the chat.
    expect((await prepareMessage(mod.actor, (await confirmation(o.orderId)).id)).text.length).toBeGreaterThan(0)
  })

  it('the test message needs management permission and a valid number; errors never include the token', async () => {
    const { owner, mod } = await setup()
    await expect(sendAutoTestMessage(mod.actor, '0501234567', 'ar')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(sendAutoTestMessage(owner.actor, 'abc', 'ar')).rejects.toMatchObject({ code: 'validation_failed' })
    expect(await sendAutoTestMessage(owner.actor, '0501234567', 'ar')).toEqual({ ok: true })
    expect(calls[0]!.form.get('to')).toBe('+966501234567')
    mockAnswer(() => ({ status: 401, body: JSON.stringify({ error: 'Wrong token test-token. Please provide a valid token' }) }))
    const r = await sendAutoTestMessage(owner.actor, '0501234567', 'ar')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('test-token')
  })
})
