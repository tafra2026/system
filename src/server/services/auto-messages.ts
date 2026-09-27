import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { MESSAGE_KINDS, type MessageKind } from '@/domain/messages'
import { normalizePhone } from '@/domain/phone'
import { authorize, type Actor } from '../authz/actor'
import { writeAudit } from '../audit'
import { getDb } from '../db'
import { customers, messageTasks, orders, visits, type MessageTask } from '../db/schema'
import { sendWhatsAppText, ultramsgConfigured } from '../integrations/ultramsg'
import { ValidationError } from './errors'
import { renderTaskMessage } from './messages'
import { getSetting, setSetting } from './settings'

/**
 * Automatic WhatsApp sending through UltraMsg (D81), run by the background worker.
 *
 * Safety rules:
 * - Off until management switches it on per message type; only tasks that became due after
 *   switching on are sent (no flood of old messages), and never older than 12 hours.
 * - Only tasks nobody has touched (status "ready"). A task a person opened stays with that person.
 * - Test orders/customers are never messaged.
 * - A task is claimed ("sending") before the call, so two workers can never send it twice.
 * - "Certainly not sent" failures retry up to 3 times, then the task goes back to staff (with a
 *   notification). "Maybe sent" (timeout) is NEVER retried automatically — staff check the chat.
 * - A few seconds between messages, a few messages per pass (gentle on the WhatsApp number).
 */

export const AUTO_MAX_ATTEMPTS = 3
const PER_PASS = 5
const MAX_AGE_MS = 12 * 3600_000
/** "On the way" is pointless once the visit is under way. */
const ON_THE_WAY_MAX_AGE_MS = 2 * 3600_000
const STUCK_AFTER_MS = 10 * 60_000

export interface AutoPassResult {
  sent: number
  failed: number
  uncertain: number
}

export async function autoSendDueMessages(now = new Date(), opts: { gapMs?: number } = {}): Promise<AutoPassResult> {
  const db = getDb()
  const result: AutoPassResult = { sent: 0, failed: 0, uncertain: 0 }
  // A claim left behind by a crash: it may or may not have gone out — hand it to staff.
  await db
    .update(messageTasks)
    .set({ autoState: 'uncertain', autoError: 'interrupted', notifiedAt: null, updatedAt: now })
    .where(and(eq(messageTasks.autoState, 'sending'), eq(messageTasks.status, 'ready'), lt(messageTasks.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS))))

  const config = await getSetting(db, 'auto_whatsapp')
  if (!config.enabled || !config.kinds.length || !config.since || !ultramsgConfigured()) return result
  const since = new Date(Math.max(new Date(config.since).getTime(), now.getTime() - MAX_AGE_MS))

  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ t: messageTasks })
      .from(messageTasks)
      .innerJoin(orders, eq(orders.id, messageTasks.orderId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(visits, eq(visits.id, messageTasks.visitId))
      .where(
        and(
          eq(messageTasks.status, 'ready'),
          inArray(messageTasks.kind, config.kinds),
          lte(messageTasks.dueAt, now),
          gte(messageTasks.dueAt, since),
          or(isNull(messageTasks.autoState), and(eq(messageTasks.autoState, 'failed'), lte(messageTasks.autoNextAt, now))),
          eq(orders.isTest, false),
          eq(customers.isTest, false),
          // A reminder only while the visit is still ahead; "on the way" only while fresh.
          sql`(${messageTasks.kind} <> 'visit_reminder' OR ${visits.startsAt} > ${now})`,
          sql`(${messageTasks.kind} <> 'on_the_way' OR ${messageTasks.dueAt} >= ${new Date(now.getTime() - ON_THE_WAY_MAX_AGE_MS)})`,
        ),
      )
      .orderBy(messageTasks.dueAt)
      .limit(PER_PASS)
      .for('update', { of: messageTasks, skipLocked: true })
    for (const { t } of rows) {
      await tx
        .update(messageTasks)
        .set({ autoState: 'sending', autoAttempts: t.autoAttempts + 1, updatedAt: now })
        .where(eq(messageTasks.id, t.id))
    }
    return rows.map((r) => ({ ...r.t, autoAttempts: r.t.autoAttempts + 1 }))
  })

  for (const [i, t] of claimed.entries()) {
    if (i > 0 && (opts.gapMs ?? 4000) > 0) await new Promise((r) => setTimeout(r, opts.gapMs ?? 4000))
    const outcome = await sendOne(t)
    result[outcome]++
  }
  return result
}

async function sendOne(t: MessageTask): Promise<keyof AutoPassResult> {
  const db = getDb()
  let res: Awaited<ReturnType<typeof sendWhatsAppText>>
  try {
    const msg = await renderTaskMessage(db, t)
    res = await sendWhatsAppText(msg.phoneE164, msg.text, `pm-${t.id}`)
  } catch {
    res = { ok: false, code: 'rejected', detail: 'could not prepare the message' }
  }
  const now = new Date()
  const stillOpen = and(eq(messageTasks.id, t.id), inArray(messageTasks.status, ['ready', 'opened']))
  if (res.ok) {
    const done = await db
      .update(messageTasks)
      .set({ status: 'sent', sentConfirmedAt: now, autoState: 'sent', autoSentAt: now, autoProviderId: res.providerId || null, autoError: null, updatedAt: now })
      .where(stillOpen)
      .returning({ id: messageTasks.id })
    if (!done.length) {
      // Cancelled (e.g. rescheduled) while it was being sent: keep a record that it went out anyway.
      await writeAudit(db, { actorUserId: null, action: 'message.auto_sent_after_cancel', entityType: 'order', entityId: t.orderId, after: { task: t.id, kind: t.kind } })
    }
    return 'sent'
  }
  if (res.code === 'unknown') {
    await db.update(messageTasks).set({ autoState: 'uncertain', autoError: res.detail ?? 'unknown', notifiedAt: null, updatedAt: now }).where(stillOpen)
    return 'uncertain'
  }
  const giveUp = t.autoAttempts >= AUTO_MAX_ATTEMPTS
  await db
    .update(messageTasks)
    .set({
      autoState: giveUp ? 'gave_up' : 'failed',
      autoError: [res.code, res.detail].filter(Boolean).join(': ').slice(0, 200),
      autoNextAt: giveUp ? null : new Date(now.getTime() + 2 ** t.autoAttempts * 60_000),
      // Back to staff: the worker announces it again as a due message.
      ...(giveUp ? { notifiedAt: null } : {}),
      updatedAt: now,
    })
    .where(stillOpen)
  return 'failed'
}

// ─────────────────────────────── Settings (management) ───────────────────────────────

export function autoSendStatus() {
  return { configured: ultramsgConfigured() }
}

const settingsInput = z.object({ enabled: z.boolean(), kinds: z.array(z.enum(MESSAGE_KINDS)) })

/** Switch automatic sending on/off. Switching on starts a new "since" (no old messages are sent). */
export async function saveAutoWhatsappSettings(actor: Actor, raw: unknown) {
  authorize(actor, 'settings.manage')
  const input = settingsInput.safeParse(raw)
  if (!input.success) throw new ValidationError('validation_failed')
  const current = await getSetting(getDb(), 'auto_whatsapp')
  const kinds = [...new Set(input.data.kinds)] as MessageKind[]
  const enabled = input.data.enabled && kinds.length > 0
  const since = enabled ? (current.enabled && current.since ? current.since : new Date().toISOString()) : null
  await setSetting(actor, 'auto_whatsapp', { enabled, kinds, since })
}

/** Owner check that the UltraMsg connection works: one text to a number she enters. */
export async function sendAutoTestMessage(actor: Actor, rawPhone: unknown, locale: 'ar' | 'en') {
  authorize(actor, 'settings.manage')
  const phone = typeof rawPhone === 'string' ? normalizePhone(rawPhone) : null
  if (!phone) throw new ValidationError('validation_failed', { phone: 'phone_invalid' })
  const text = locale === 'en' ? 'Test message from the Pamper Me system.' : 'رسالة تجريبية من نظام Pamper Me.'
  const res = await sendWhatsAppText(phone, text, `pm-test-${Date.now()}`)
  await writeAudit(getDb(), { actorUserId: actor.userId, action: 'message.auto_test', entityType: 'setting', entityId: 'auto_whatsapp', after: { ok: res.ok, code: res.ok ? null : res.code } })
  return res.ok ? { ok: true as const } : { ok: false as const, code: res.code, detail: res.detail ?? null }
}
