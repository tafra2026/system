import { and, asc, desc, eq, gt, inArray, isNotNull, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_MESSAGE_TEMPLATES, reminderDueAt, renderMessage, whatsappChatLink, type MessageKind, type MessageLocale, type MessageValues } from '@/domain/messages'
import { formatDate, formatMoney, formatTime } from '@/i18n/format'
import { can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { getDb, type Executor } from '../db'
import { customers, employees, messageTasks, orderLines, orders, tripLegs, visits, type MessageTask } from '../db/schema'
import { orderBalance } from './commissions'
import { NotFoundError, ValidationError } from './errors'
import { getSetting } from './settings'

const OPEN_STATUSES = ['ready', 'opened'] as const

interface DesiredTask {
  kind: MessageKind
  visitId: string | null
  dedupeKey: string
  dueAt: Date
  assigneeEmployeeId: string | null
}

/**
 * Bring an order's WhatsApp tasks in line with its current state. Called inside the
 * transaction of every change that affects messages (confirm, reschedule, complete,
 * pending review, driver started). Runs under the order lock and is idempotent:
 * unchanged tasks are kept, stale open tasks are cancelled, and the partial unique index
 * on `dedupe_key` makes duplicate creation impossible even for concurrent retries.
 */
export async function syncMessageTasks(tx: Executor, orderId: string, now = new Date()): Promise<void> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
  if (!o) return
  const desired: DesiredTask[] = []
  // Keys that stay valid but must NOT be created again (e.g. reminder of a visit that already started).
  const keep = new Set<string>()

  if (o.status !== 'draft') {
    desired.push({ kind: 'booking_confirmation', visitId: null, dedupeKey: `confirm:${o.id}`, dueAt: o.confirmedAt ?? now, assigneeEmployeeId: null })
    const vs = await tx.select().from(visits).where(eq(visits.orderId, o.id))
    const legs = vs.length
      ? await tx
          .select()
          .from(tripLegs)
          .where(and(inArray(tripLegs.visitId, vs.map((v) => v.id)), eq(tripLegs.kind, 'dropoff')))
      : []
    const sender = await getSetting(tx, 'on_the_way_sender')
    for (const v of vs) {
      if (v.status === 'scheduled' && v.startsAt) {
        const key = `reminder:${v.id}:${v.startsAt.toISOString()}`
        const due = reminderDueAt(v.startsAt, now)
        if (due) desired.push({ kind: 'visit_reminder', visitId: v.id, dedupeKey: key, dueAt: due, assigneeEmployeeId: null })
        else keep.add(key)
        const leg = legs.find((l) => l.visitId === v.id)
        if (leg?.startedAt) {
          desired.push({
            kind: 'on_the_way',
            visitId: v.id,
            dedupeKey: `onway:${v.id}:${leg.startedAt.toISOString()}`,
            dueAt: leg.startedAt,
            assigneeEmployeeId: sender === 'moderator' ? o.moderatorEmployeeId : leg.driverEmployeeId,
          })
        }
      }
    }
    if (o.status === 'completed') desired.push({ kind: 'review_request', visitId: null, dedupeKey: `review:${o.id}`, dueAt: now, assigneeEmployeeId: null })
  }

  const wanted = new Set([...desired.map((d) => d.dedupeKey), ...keep])
  // Cancel open tasks that no longer match (rescheduled, visit done/under review, order changed).
  // Once the visit is completed its review request supersedes the confirmation too, but a
  // confirmation nobody sent yet is still useful, so it is only cancelled with the order itself.
  const open = await tx
    .select()
    .from(messageTasks)
    .where(and(eq(messageTasks.orderId, o.id), inArray(messageTasks.status, [...OPEN_STATUSES])))
  for (const t of open) {
    if (!wanted.has(t.dedupeKey)) {
      await tx
        .update(messageTasks)
        .set({ status: 'cancelled', cancelledAt: now, cancelReason: 'superseded', updatedAt: now })
        .where(eq(messageTasks.id, t.id))
    }
  }
  for (const d of desired) {
    await tx
      .insert(messageTasks)
      .values({ kind: d.kind, orderId: o.id, visitId: d.visitId, dedupeKey: d.dedupeKey, dueAt: d.dueAt, assigneeEmployeeId: d.assigneeEmployeeId })
      .onConflictDoNothing()
  }
}

// ─────────────────────────────── Access ───────────────────────────────

/** Operations staff see every task; anyone else only the tasks assigned to them. */
function visibilityFilter(actor: Actor) {
  if (can(actor, 'messages.send')) return undefined
  if (actor.role === 'driver') return eq(messageTasks.assigneeEmployeeId, actor.employeeId)
  throw new ForbiddenError('messages.send')
}

async function loadTaskFor(actor: Actor, db: Executor, taskId: string, lock = false): Promise<MessageTask> {
  if (!z.uuid().safeParse(taskId).success) throw new NotFoundError()
  const q = db.select().from(messageTasks).where(eq(messageTasks.id, taskId))
  const [t] = lock ? await q.for('update') : await q
  if (!t) throw new NotFoundError()
  if (!can(actor, 'messages.send') && !(actor.role === 'driver' && t.assigneeEmployeeId === actor.employeeId)) {
    // Same answer as a missing task: do not reveal that it exists.
    throw new NotFoundError()
  }
  return t
}

// ─────────────────────────────── Listing ───────────────────────────────

export type MessageListScope = 'due' | 'upcoming' | 'done'

export interface MessageTaskRow {
  id: string
  kind: MessageKind
  status: MessageTask['status']
  dueAt: Date
  orderId: string
  orderReference: string
  customerName: string
  visitStartsAt: Date | null
  assigneeName: string | null
  assignedToMe: boolean
  sentConfirmedAt: Date | null
  cancelReason: string | null
  /** The visit has already started (or passed) and the reminder was not sent. */
  late: boolean
}

export async function listMessageTasks(actor: Actor, scope: MessageListScope, now = new Date()): Promise<MessageTaskRow[]> {
  const filter = visibilityFilter(actor)
  const scopeFilter =
    scope === 'due'
      ? and(inArray(messageTasks.status, [...OPEN_STATUSES]), lte(messageTasks.dueAt, now))
      : scope === 'upcoming'
        ? and(eq(messageTasks.status, 'ready'), gt(messageTasks.dueAt, now))
        : and(notInArray(messageTasks.status, [...OPEN_STATUSES]), gt(messageTasks.updatedAt, new Date(now.getTime() - 14 * 86_400_000)))
  const rows = await getDb()
    .select({
      t: messageTasks,
      reference: orders.reference,
      isTest: orders.isTest,
      customerName: customers.name,
      startsAt: visits.startsAt,
      assigneeName: employees.fullName,
      assigneeNameEn: employees.displayNameEn,
    })
    .from(messageTasks)
    .innerJoin(orders, eq(orders.id, messageTasks.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(visits, eq(visits.id, messageTasks.visitId))
    .leftJoin(employees, eq(employees.id, messageTasks.assigneeEmployeeId))
    .where(and(scopeFilter, filter))
    .orderBy(scope === 'done' ? desc(messageTasks.updatedAt) : asc(messageTasks.dueAt))
    .limit(200)
  return rows.map((r) => ({
    id: r.t.id,
    kind: r.t.kind,
    status: r.t.status,
    dueAt: r.t.dueAt,
    orderId: r.t.orderId,
    orderReference: r.reference,
    customerName: r.customerName,
    visitStartsAt: r.startsAt,
    assigneeName: r.assigneeName ? (actor.locale === 'en' && r.assigneeNameEn ? r.assigneeNameEn : r.assigneeName) : null,
    assignedToMe: r.t.assigneeEmployeeId === actor.employeeId,
    sentConfirmedAt: r.t.sentConfirmedAt,
    cancelReason: r.t.cancelReason,
    late: r.t.kind === 'visit_reminder' && OPEN_STATUSES.includes(r.t.status as 'ready') && !!r.startsAt && r.startsAt <= now,
  }))
}

/** Number of due, unsent messages the actor can act on (for the dashboard and navigation). */
export async function countDueMessages(actor: Actor, now = new Date()): Promise<number> {
  if (!can(actor, 'messages.send') && actor.role !== 'driver') return 0
  const filter = visibilityFilter(actor)
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(messageTasks)
    .where(and(inArray(messageTasks.status, [...OPEN_STATUSES]), lte(messageTasks.dueAt, now), filter))
  return row?.n ?? 0
}

/** Tasks of one order (order page). */
export async function orderMessageTasks(actor: Actor, orderId: string) {
  if (!can(actor, 'messages.send')) return []
  return getDb()
    .select({ id: messageTasks.id, kind: messageTasks.kind, status: messageTasks.status, dueAt: messageTasks.dueAt, sentConfirmedAt: messageTasks.sentConfirmedAt, cancelReason: messageTasks.cancelReason })
    .from(messageTasks)
    .where(and(eq(messageTasks.orderId, orderId), or(ne(messageTasks.status, 'cancelled'), isNotNull(messageTasks.sentConfirmedAt))))
    .orderBy(asc(messageTasks.dueAt))
}

/** Open "on the way" task the driver can send for a visit (my trips page). */
export async function myOnTheWayTasks(actor: Actor, visitIds: string[]) {
  if (!visitIds.length) return new Map<string, { id: string; status: MessageTask['status'] }>()
  const rows = await getDb()
    .select({ id: messageTasks.id, visitId: messageTasks.visitId, status: messageTasks.status })
    .from(messageTasks)
    .where(
      and(
        eq(messageTasks.kind, 'on_the_way'),
        inArray(messageTasks.visitId, visitIds),
        eq(messageTasks.assigneeEmployeeId, actor.employeeId),
        ne(messageTasks.status, 'cancelled'),
      ),
    )
  return new Map(rows.map((r) => [r.visitId!, { id: r.id, status: r.status }]))
}

// ─────────────────────────────── Preparing the text ───────────────────────────────

export async function templateFor(db: Executor, kind: MessageKind, locale: MessageLocale): Promise<string> {
  const custom = await getSetting(db, 'message_templates')
  return custom[kind]?.[locale] ?? DEFAULT_MESSAGE_TEMPLATES[kind][locale]
}

export interface PreparedMessage {
  taskId: string
  kind: MessageKind
  status: MessageTask['status']
  locale: MessageLocale
  text: string
  /** wa.me link that opens the customer's chat with the text filled in. It never sends. */
  link: string
  phoneE164: string
}

/**
 * Render the message from the order's CURRENT data (paid/remaining are always fresh).
 * Customer data is only returned to people allowed to act on this task.
 */
export async function prepareMessage(actor: Actor, taskId: string): Promise<PreparedMessage> {
  const db = getDb()
  const t = await loadTaskFor(actor, db, taskId)
  if (t.status === 'cancelled') throw new ValidationError('message_cancelled')
  const [row] = await db
    .select({ o: orders, customerName: customers.name, phone: customers.phoneE164, locale: customers.messageLocale })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, t.orderId))
  if (!row) throw new NotFoundError()
  const locale = row.locale
  const lines = await db.select({ nameAr: orderLines.nameAr, nameEn: orderLines.nameEn }).from(orderLines).where(eq(orderLines.orderId, t.orderId)).orderBy(asc(orderLines.sortOrder))
  const balance = await orderBalance(db, t.orderId)

  // Which visit the date/time refer to: the task's own visit, else the next scheduled one.
  const vs = await db.select().from(visits).where(eq(visits.orderId, t.orderId)).orderBy(asc(visits.sequence))
  const visit = (t.visitId ? vs.find((v) => v.id === t.visitId) : null) ?? vs.filter((v) => v.startsAt).sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime())[0]
  let arrival: Date | null = null
  if (t.kind === 'on_the_way' && t.visitId) {
    const [leg] = await db.select({ arriveAt: tripLegs.arriveAt }).from(tripLegs).where(and(eq(tripLegs.visitId, t.visitId), eq(tripLegs.kind, 'dropoff')))
    arrival = leg?.arriveAt ?? null
  }
  const values: MessageValues = {
    customer_name: row.customerName,
    order_ref: row.o.reference,
    date: visit?.startsAt ? formatDate(visit.startsAt, locale) : '',
    time: visit?.startsAt ? formatTime(visit.startsAt, locale) : '',
    services: lines.map((l) => (locale === 'en' ? l.nameEn : l.nameAr)).join(locale === 'en' ? ', ' : '، '),
    total: formatMoney(balance.total, locale),
    paid: formatMoney(balance.confirmed, locale),
    remaining: formatMoney(Math.max(0, balance.remaining), locale),
    arrival_time: arrival ? formatTime(arrival, locale) : '',
    review_link: (await getSetting(db, 'review_link')) ?? '',
  }
  const text = renderMessage(await templateFor(db, t.kind, locale), values)
  return { taskId: t.id, kind: t.kind, status: t.status, locale, text, link: whatsappChatLink(row.phone, text), phoneE164: row.phone }
}

// ─────────────────────────────── Status changes ───────────────────────────────

/** Staff opened the chat. This is NOT proof the message was sent. */
export async function markMessageOpened(actor: Actor, taskId: string) {
  await getDb().transaction(async (tx) => {
    const t = await loadTaskFor(actor, tx, taskId, true)
    if (t.status !== 'ready') return
    await tx.update(messageTasks).set({ status: 'opened', openedAt: new Date(), openedByUserId: actor.userId, updatedAt: new Date() }).where(eq(messageTasks.id, t.id))
  })
}

/** Staff confirms she pressed send in WhatsApp. Idempotent. Not a delivery/read receipt. */
export async function confirmMessageSent(actor: Actor, taskId: string) {
  await getDb().transaction(async (tx) => {
    const t = await loadTaskFor(actor, tx, taskId, true)
    if (t.status === 'sent') return
    if (t.status === 'cancelled') throw new ValidationError('message_cancelled')
    const now = new Date()
    await tx
      .update(messageTasks)
      .set({ status: 'sent', sentConfirmedAt: now, sentConfirmedByUserId: actor.userId, openedAt: t.openedAt ?? now, openedByUserId: t.openedByUserId ?? actor.userId, updatedAt: now })
      .where(eq(messageTasks.id, t.id))
  })
}

/** Operations staff may drop a task that should not be sent (e.g. the customer asked not to). */
export async function dismissMessage(actor: Actor, taskId: string) {
  if (!can(actor, 'messages.send')) throw new ForbiddenError('messages.send')
  await getDb().transaction(async (tx) => {
    const t = await loadTaskFor(actor, tx, taskId, true)
    if (t.status === 'sent' || t.status === 'cancelled') return
    await tx.update(messageTasks).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'dismissed', updatedAt: new Date() }).where(eq(messageTasks.id, t.id))
  })
}
