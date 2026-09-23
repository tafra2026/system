import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createTranslator, type Locale } from '@/i18n'
import { formatDateTime, formatMoney } from '@/i18n/format'
import type { Actor } from '../authz/actor'
import { hasPermission, type Permission } from '../authz/permissions'
import { getDb, type Executor } from '../db'
import { employees, messageTasks, notifications, orders, tripLegs, users, visits, visitSpecialists, type Notification, type NotificationKind } from '../db/schema'
import { NotFoundError } from './errors'

/**
 * Notification centre (spec §14). Rows are written inside the same transaction as the
 * change they describe, so a rolled-back change never notifies anyone. Web Push is sent
 * afterwards by the background worker from these rows; the in-app list always works,
 * also when Push is refused or unsupported.
 */

export interface NotificationParams {
  reference?: string
  /** ISO time of the visit/trip. */
  at?: string
  amountHalalas?: number
  messageKind?: string
}

interface NotifyInput {
  employeeIds?: string[]
  userIds?: string[]
  kind: NotificationKind
  params: NotificationParams
  link: string
  dedupeKey?: string
  /** The person who made the change is not notified about it. */
  excludeUserId?: string | null
}

/** Active login accounts of active employees. */
async function activeUsersOf(tx: Executor, employeeIds: string[]) {
  if (!employeeIds.length) return []
  return tx
    .select({ userId: users.id, employeeId: users.employeeId, role: employees.role })
    .from(users)
    .innerJoin(employees, eq(employees.id, users.employeeId))
    .where(and(inArray(users.employeeId, employeeIds), eq(users.status, 'active'), eq(employees.status, 'active')))
}

async function activeUsersWith(tx: Executor, permission: Permission) {
  const rows = await tx
    .select({ userId: users.id, role: employees.role })
    .from(users)
    .innerJoin(employees, eq(employees.id, users.employeeId))
    .where(and(eq(users.status, 'active'), eq(employees.status, 'active')))
  return rows.filter((r) => hasPermission(r.role, permission)).map((r) => r.userId)
}

export async function notify(tx: Executor, input: NotifyInput): Promise<number> {
  const fromEmployees = (await activeUsersOf(tx, [...new Set(input.employeeIds ?? [])])).map((u) => u.userId)
  const targets = [...new Set([...fromEmployees, ...(input.userIds ?? [])])].filter((id) => id !== input.excludeUserId)
  if (!targets.length) return 0
  const rows = await tx
    .insert(notifications)
    .values(targets.map((userId) => ({ userId, kind: input.kind, params: input.params, link: input.link, dedupeKey: input.dedupeKey ?? null })))
    .onConflictDoNothing()
    .returning({ id: notifications.id })
  return rows.length
}

// ─────────────────────────────── Visit assignment & time changes ───────────────────────────────

export interface VisitPeople {
  startsAt: Date | null
  specialists: Set<string>
  drivers: Set<string>
}

export const NOBODY: VisitPeople = { startsAt: null, specialists: new Set(), drivers: new Set() }

/** Who is booked on a visit right now (reserved specialists and trip drivers) and when. */
export async function visitPeople(tx: Executor, visitId: string): Promise<VisitPeople> {
  const [v] = await tx.select({ startsAt: visits.startsAt, status: visits.status }).from(visits).where(eq(visits.id, visitId))
  if (!v || v.status !== 'scheduled') return NOBODY
  const specs = await tx
    .select({ id: visitSpecialists.employeeId })
    .from(visitSpecialists)
    .where(and(eq(visitSpecialists.visitId, visitId), eq(visitSpecialists.blocking, true)))
  const legs = await tx.select({ id: tripLegs.driverEmployeeId }).from(tripLegs).where(eq(tripLegs.visitId, visitId))
  return { startsAt: v.startsAt, specialists: new Set(specs.map((s) => s.id)), drivers: new Set(legs.map((l) => l.id)) }
}

/**
 * Compare who was on a visit before a change with who is on it now and tell each person
 * what changed for THEM: newly assigned, removed, or same booking at a new time.
 */
export async function notifyVisitChanges(tx: Executor, visitId: string, before: VisitPeople, actorUserId: string | null) {
  const after = await visitPeople(tx, visitId)
  const [o] = await tx.select({ reference: orders.reference }).from(visits).innerJoin(orders, eq(orders.id, visits.orderId)).where(eq(visits.id, visitId))
  if (!o) return
  const timeChanged = !!after.startsAt && !!before.startsAt && after.startsAt.getTime() !== before.startsAt.getTime()
  const at = (after.startsAt ?? before.startsAt)?.toISOString()
  const base = { excludeUserId: actorUserId, params: { reference: o.reference, at } }
  const groups: [Set<string>, Set<string>, NotificationKind, NotificationKind, string][] = [
    [before.specialists, after.specialists, 'visit_assigned', 'visit_unassigned', '/schedule'],
    [before.drivers, after.drivers, 'trip_assigned', 'trip_unassigned', '/my-trips'],
  ]
  for (const [was, now, added, removed, link] of groups) {
    const newcomers = [...now].filter((id) => !was.has(id))
    const leavers = [...was].filter((id) => !now.has(id))
    const stayed = [...now].filter((id) => was.has(id))
    await notify(tx, { ...base, employeeIds: newcomers, kind: added, link })
    await notify(tx, { ...base, params: { reference: o.reference, at: before.startsAt?.toISOString() }, employeeIds: leavers, kind: removed, link })
    if (timeChanged) await notify(tx, { ...base, employeeIds: stayed, kind: 'visit_rescheduled', link })
  }
}

// ─────────────────────────────── Payments ───────────────────────────────

export async function notifyTransferPending(tx: Executor, reference: string, amountHalalas: number, actorUserId: string) {
  await notify(tx, { userIds: await activeUsersWith(tx, 'payments.approve_transfer'), kind: 'transfer_pending', params: { reference, amountHalalas }, link: '/cash', excludeUserId: actorUserId })
}

export async function notifyPaymentDecision(tx: Executor, p: { orderId: string; amountHalalas: number; recordedByUserId: string | null }, approved: boolean, actorUserId: string) {
  const [o] = await tx.select({ reference: orders.reference, moderatorEmployeeId: orders.moderatorEmployeeId }).from(orders).where(eq(orders.id, p.orderId))
  if (!o) return
  await notify(tx, {
    userIds: p.recordedByUserId ? [p.recordedByUserId] : [],
    employeeIds: o.moderatorEmployeeId ? [o.moderatorEmployeeId] : [],
    kind: approved ? 'payment_confirmed' : 'payment_rejected',
    params: { reference: o.reference, amountHalalas: p.amountHalalas },
    link: `/orders/${p.orderId}`,
    excludeUserId: actorUserId,
  })
}

// ─────────────────────────────── Due WhatsApp messages (background worker) ───────────────────────────────

/** Tasks that became due more than this long ago (e.g. the worker was down) are not announced late. */
const STALE_AFTER_MS = 12 * 3600_000

/**
 * Announce WhatsApp tasks that have become due (e.g. the reminder three hours before a visit).
 * Runs in the background worker, so it does not depend on anyone keeping a page open.
 * Recipient: the task's assignee; else the order's moderator; else all active moderators.
 * A driver who just tapped "started" already sees her own "on the way" message, so she is not notified.
 */
export async function createDueMessageNotifications(tx: Executor, now = new Date()): Promise<number> {
  const due = await tx
    .select({ t: messageTasks, reference: orders.reference, moderatorEmployeeId: orders.moderatorEmployeeId })
    .from(messageTasks)
    .innerJoin(orders, eq(orders.id, messageTasks.orderId))
    .where(and(inArray(messageTasks.status, ['ready', 'opened']), isNull(messageTasks.notifiedAt), sql`${messageTasks.dueAt} <= ${now}`))
    .for('update', { of: messageTasks, skipLocked: true })
    .limit(200)
  let created = 0
  for (const { t, reference, moderatorEmployeeId } of due) {
    await tx.update(messageTasks).set({ notifiedAt: now }).where(eq(messageTasks.id, t.id))
    if (now.getTime() - t.dueAt.getTime() > STALE_AFTER_MS) continue
    if (t.kind === 'on_the_way' && t.visitId && t.assigneeEmployeeId) {
      const [leg] = await tx.select({ driver: tripLegs.driverEmployeeId }).from(tripLegs).where(and(eq(tripLegs.visitId, t.visitId), eq(tripLegs.kind, 'dropoff')))
      if (leg?.driver === t.assigneeEmployeeId) continue
    }
    let employeeIds = t.assigneeEmployeeId ? [t.assigneeEmployeeId] : moderatorEmployeeId ? [moderatorEmployeeId] : []
    if (!employeeIds.length || !(await activeUsersOf(tx, employeeIds)).length) {
      const mods = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.role, 'moderator'), eq(employees.status, 'active')))
      employeeIds = mods.map((m) => m.id)
    }
    created += await notify(tx, { employeeIds, kind: 'message_due', params: { reference, messageKind: t.kind }, link: '/messages', dedupeKey: `msg:${t.id}` })
  }
  return created
}

// ─────────────────────────────── Rendering ───────────────────────────────

/** Title and body in the recipient's language. Only reference/time/amount — safe for a lock screen. */
export function renderNotification(n: Pick<Notification, 'kind' | 'params'>, locale: Locale): { title: string; body: string } {
  const t = createTranslator(locale)
  const p = (n.params ?? {}) as NotificationParams
  const vars = {
    reference: p.reference ?? '',
    time: p.at ? formatDateTime(new Date(p.at), locale) : '',
    amount: p.amountHalalas != null ? formatMoney(p.amountHalalas, locale) : '',
    message: p.messageKind ? t(`messages.kinds.${p.messageKind as 'visit_reminder'}`) : '',
  }
  return { title: t(`notifications.kinds.${n.kind}.title`), body: t(`notifications.kinds.${n.kind}.body`, vars) }
}

// ─────────────────────────────── The user's own centre ───────────────────────────────

export async function myNotifications(actor: Actor, limit = 100) {
  const rows = await getDb()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, actor.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
  return rows.map((n) => ({ id: n.id, createdAt: n.createdAt, read: !!n.readAt, link: n.link, ...renderNotification(n, actor.locale) }))
}

export async function unreadNotificationCount(actor: Actor): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)))
  return row?.n ?? 0
}

/** Marks one of the actor's own notifications as read and returns where it points. */
export async function openNotification(actor: Actor, id: string): Promise<string> {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError()
  const [n] = await getDb()
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, actor.userId)))
    .returning({ link: notifications.link })
  if (!n) throw new NotFoundError()
  return n.link
}

export async function markAllNotificationsRead(actor: Actor) {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)))
}

/** Housekeeping: notifications older than 90 days are removed. */
export async function purgeOldNotifications(tx: Executor, now = new Date()) {
  await tx.delete(notifications).where(lt(notifications.createdAt, new Date(now.getTime() - 90 * 86_400_000)))
}
