import webpush from 'web-push'
import { z } from 'zod'
import { createTranslator } from '@/i18n'
import type { Actor } from './authz/actor'
import { getDb } from './db'
import { ValidationError } from './services/errors'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Executor } from './db'
import { notifications, pushSubscriptions, users } from './db/schema'
import { renderNotification } from './services/notifications'

/**
 * Web Push delivery (spec §14). Keys come from the server environment only:
 * VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https: contact).
 * Without them Push is simply off and the in-app notification centre still works.
 */
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

export function pushConfigured(): boolean {
  return !!(pushPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim() && process.env.VAPID_SUBJECT?.trim())
}

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}
export type PushResult = { ok: true } | { ok: false; gone: boolean }
export type PushTransport = (target: PushTarget, payload: string) => Promise<PushResult>

const webPushTransport: PushTransport = async (target, payload) => {
  try {
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
      TTL: 6 * 3600,
      urgency: 'high',
      vapidDetails: { subject: process.env.VAPID_SUBJECT!.trim(), publicKey: pushPublicKey()!, privateKey: process.env.VAPID_PRIVATE_KEY!.trim() },
    })
    return { ok: true }
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    // 404/410: the browser dropped this subscription (uninstalled, permission revoked).
    return { ok: false, gone: status === 404 || status === 410 }
  }
}

let transport: PushTransport = webPushTransport
let forceConfigured = false

/**
 * TESTS ONLY — development mock: replaces the real push service with a recorder so that
 * tests never contact Google/Apple/Mozilla push servers.
 */
export function useMockPushTransportForTests(mock: PushTransport | null) {
  transport = mock ?? webPushTransport
  forceConfigured = !!mock
}

/** Notifications older than this are not pushed any more (they stay in the in-app centre). */
const PUSH_WINDOW_MS = 2 * 3600_000
const MAX_FAILURES = 5

/** Push the text of every pending notification to all of the recipient's devices. */
export async function deliverPendingPushes(tx: Executor, now = new Date()): Promise<{ sent: number }> {
  await tx
    .update(notifications)
    .set({ pushState: 'expired' })
    .where(and(eq(notifications.pushState, 'pending'), lt(notifications.createdAt, new Date(now.getTime() - PUSH_WINDOW_MS))))
  const pending = await tx
    .select({ n: notifications, locale: users.locale })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.pushState, 'pending'))
    .orderBy(notifications.createdAt)
    .for('update', { of: notifications, skipLocked: true })
    .limit(100)
  if (!pending.length) return { sent: 0 }
  if (!pushConfigured() && !forceConfigured) {
    await tx.update(notifications).set({ pushState: 'disabled' }).where(inArray(notifications.id, pending.map((p) => p.n.id)))
    return { sent: 0 }
  }
  const subs = await tx.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...new Set(pending.map((p) => p.n.userId))]))
  let sent = 0
  for (const { n, locale } of pending) {
    const mine = subs.filter((s) => s.userId === n.userId)
    if (!mine.length) {
      await tx.update(notifications).set({ pushState: 'no_device' }).where(eq(notifications.id, n.id))
      continue
    }
    const { title, body } = renderNotification(n, locale)
    const payload = JSON.stringify({ title, body, url: n.link, tag: n.id, lang: locale, dir: locale === 'ar' ? 'rtl' : 'ltr' })
    let any = false
    for (const s of mine) {
      const r = await transport({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload)
      if (r.ok) {
        any = true
        await tx.update(pushSubscriptions).set({ failedCount: 0, lastSuccessAt: now }).where(eq(pushSubscriptions.id, s.id))
      } else if (r.gone || s.failedCount + 1 >= MAX_FAILURES) {
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id))
      } else {
        await tx.update(pushSubscriptions).set({ failedCount: sql`${pushSubscriptions.failedCount} + 1` }).where(eq(pushSubscriptions.id, s.id))
      }
    }
    if (any) sent++
    await tx.update(notifications).set({ pushState: any ? 'sent' : 'failed', pushedAt: now }).where(eq(notifications.id, n.id))
  }
  return { sent }
}

// ─────────────────────────────── Devices of the signed-in user ───────────────────────────────


const b64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(200)
const subscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({ p256dh: b64url, auth: b64url }),
  deviceLabel: z.string().trim().max(60).optional(),
})

/**
 * Save this browser's push subscription for the signed-in user. If the device was used by
 * someone else before, it now belongs to the current user only.
 */
export async function savePushSubscription(actor: Actor, raw: unknown) {
  const parsed = subscriptionSchema.safeParse(raw)
  if (!parsed.success) throw new ValidationError('validation_failed', { subscription: 'invalid' })
  const { endpoint, keys, deviceLabel } = parsed.data
  await getDb()
    .insert(pushSubscriptions)
    .values({ userId: actor.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceLabel: deviceLabel || null })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: actor.userId, p256dh: keys.p256dh, auth: keys.auth, deviceLabel: deviceLabel || null, failedCount: 0 },
    })
}

/** Remove a device (only the caller's own). */
export async function removePushSubscription(actor: Actor, endpoint: unknown) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return
  await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, actor.userId), eq(pushSubscriptions.endpoint, endpoint)))
}

export async function myPushDeviceCount(actor: Actor): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, actor.userId))
  return row?.n ?? 0
}

/** "Send a test notification" to the caller's own devices. */
export async function sendTestPush(actor: Actor): Promise<{ devices: number; delivered: number }> {
  if (!pushConfigured() && !forceConfigured) throw new ValidationError('push_not_configured')
  const t = createTranslator(actor.locale)
  const payload = JSON.stringify({ title: t('notifications.testTitle'), body: t('notifications.testBody'), url: '/notifications', tag: 'test', lang: actor.locale, dir: actor.locale === 'ar' ? 'rtl' : 'ltr' })
  const subs = await getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, actor.userId))
  let delivered = 0
  for (const s of subs) {
    const r = await transport(s, payload)
    if (r.ok) delivered++
    else if (r.gone) await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id))
  }
  return { devices: subs.length, delivered }
}
