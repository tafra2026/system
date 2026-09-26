import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { COMMISSION_RULES_V1 } from '@/domain/commission'
import { DomainError } from '@/domain/errors'
import { isAllowedStartTime, operationalDateOf, riyadhLocalToInstant, riyadhParts, riyadhToday } from '@/domain/operational-day'
import { formatOrderReference, packageSessionBalance, suggestedVisitMinutes, type SessionBalance } from '@/domain/order'
import { normalizePhone } from '@/domain/phone'
import { orderTotals, priceLine, validateDeliveryFee, type LinePricing } from '@/domain/pricing'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import {
  customerAddresses,
  customers,
  employees,
  orderLines,
  orderModeratorChanges,
  orders,
  packageComponents,
  packages,
  packageSessions,
  services,
  visitItems,
  visits,
  visitSpecialists,
  type Order,
} from '../db/schema'
import { NotFoundError, ValidationError } from './errors'
import { getDaysOff, getSetting } from './settings'
import { isDayOff } from '@/domain/trips'
import { syncLegsForVisit } from './trip-sync'
import { employeesOffOn, offCalendar } from './time-off'
import { orderBalance, syncCommissions } from './commissions'
import { syncMessageTasks } from './messages'
import { cancelOpenPaymentLinks, reviewOpenLinksAfterPriceChange } from './payment-links'
import { NOBODY, notifyVisitChanges, visitPeople } from './notifications'
import { parseWith, pgErrorCode } from './validation'

// ─────────────────────────────── Input schema ───────────────────────────────

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
const money = z.number().int().min(0).max(10_000_000)
const manual = { manualFinalPrice: money.nullable().default(null), manualReason: optText(500) }
const beneficiary = z.number().int().min(1).max(20)
const visitIndex = z.number().int().min(0).max(5)

const lineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('service'), serviceId: z.uuid(), beneficiaryIndex: beneficiary, visitIndex, specialistId: z.uuid().nullable().default(null), ...manual }),
  z.object({ kind: z.literal('package'), packageId: z.uuid(), visitIndexes: z.array(visitIndex).min(1).max(6), ...manual }),
  z.object({
    kind: z.literal('custom'),
    name: z.string().trim().min(1).max(200),
    priceHalalas: money,
    durationMinutes: z.number().int().min(5).max(600),
    notes: optText(1000),
    vipEligible: z.boolean().default(false),
    beneficiaryIndex: beneficiary,
    visitIndex,
    specialistId: z.uuid().nullable().default(null),
    ...manual,
  }),
])

const visitInputSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .default(null),
  durationMinutes: z.number().int().min(5).max(720).nullable().default(null),
  specialistIds: z.array(z.uuid()).max(6).default([]),
  notes: optText(1000),
})

export const orderInputSchema = z.object({
  customerId: z.uuid(),
  addressId: z.uuid().nullable().default(null),
  personsCount: z.number().int().min(1).max(20).default(1),
  moderatorEmployeeId: z.uuid().nullable().default(null),
  deliveryFeeHalalas: z.number().int().default(0),
  notes: optText(2000),
  lines: z.array(lineSchema).max(40),
  visits: z.array(visitInputSchema).min(1).max(6),
})

export type OrderInput = z.input<typeof orderInputSchema>
type ParsedInput = z.output<typeof orderInputSchema>
type ParsedLine = ParsedInput['lines'][number]

// ─────────────────────────────── Planning (validation + pricing) ───────────────────────────────

interface PlannedItem {
  visitIndex: number
  nameAr: string
  nameEn: string
  componentServiceId: string | null
  beneficiaryIndex: number | null
  specialistEmployeeId: string | null
  taskDurationMinutes: number
}

interface PlannedLine {
  input: ParsedLine
  kind: 'service' | 'package' | 'custom'
  serviceId: string | null
  packageId: string | null
  nameAr: string
  nameEn: string
  beneficiaryIndex: number | null
  durationMinutes: number
  pricing: LinePricing
  vipEligible: boolean
  packageSnapshot: unknown
  notes: string | null
  items: PlannedItem[]
  /** Package: visit index for session 1..n. */
  sessionVisitIndexes: number[]
}

interface PlannedVisit {
  sequence: number
  startsAt: Date | null
  operationalDate: string | null
  durationMinutes: number
  specialistIds: string[]
  notes: string | null
}

interface OrderPlan {
  lines: PlannedLine[]
  visits: PlannedVisit[]
  servicesTotal: number
  deliveryFee: number
  grandTotal: number
  vipAtBooking: boolean
  addressSnapshot: unknown
}

function fieldError(field: string, code: string): never {
  throw new ValidationError('validation_failed', { [field]: code })
}

async function planOrder(db: Executor, actor: Actor, input: ParsedInput, opts: { confirm: boolean; vipAtBooking?: boolean }): Promise<OrderPlan> {
  const [customer] = await db.select().from(customers).where(eq(customers.id, input.customerId))
  if (!customer) fieldError('customerId', 'not_found')

  let addressSnapshot: unknown = null
  if (input.addressId) {
    const [addr] = await db.select().from(customerAddresses).where(and(eq(customerAddresses.id, input.addressId), eq(customerAddresses.customerId, customer.id)))
    if (!addr || addr.archivedAt) fieldError('addressId', 'invalid')
    addressSnapshot = {
      label: addr.label,
      district: addr.district,
      addressLine: addr.addressLine,
      buildingDetails: addr.buildingDetails,
      accessInstructions: addr.accessInstructions,
      latitude: addr.latitude,
      longitude: addr.longitude,
    }
  } else if (opts.confirm) fieldError('addressId', 'required')

  let deliveryFee: number
  try {
    deliveryFee = validateDeliveryFee(input.deliveryFeeHalalas)
  } catch (err) {
    if (err instanceof DomainError) throw new ValidationError('validation_failed', { deliveryFeeHalalas: err.code })
    throw err
  }

  const vipCustomer = opts.vipAtBooking ?? customer.isVip
  const vipOnPackages = await getSetting(db, 'vip_applies_to_packages')
  const daysOff = await getDaysOff(db)

  // Reference data.
  const serviceIds = input.lines.flatMap((l) => (l.kind === 'service' ? [l.serviceId] : []))
  const packageIds = input.lines.flatMap((l) => (l.kind === 'package' ? [l.packageId] : []))
  const svcRows = serviceIds.length ? await db.select().from(services).where(inArray(services.id, serviceIds)) : []
  const pkgRows = packageIds.length ? await db.select().from(packages).where(inArray(packages.id, packageIds)) : []
  const compRows = packageIds.length
    ? await db
        .select({ c: packageComponents, nameAr: services.nameAr, nameEn: services.nameEn })
        .from(packageComponents)
        .innerJoin(services, eq(services.id, packageComponents.serviceId))
        .where(inArray(packageComponents.packageId, packageIds))
        .orderBy(asc(packageComponents.sortOrder))
    : []

  // Specialists named anywhere must be active specialists.
  const allSpecialistIds = [...new Set(input.visits.flatMap((v) => v.specialistIds))]
  if (allSpecialistIds.length) {
    const rows = await db.select({ id: employees.id, role: employees.role, status: employees.status }).from(employees).where(inArray(employees.id, allSpecialistIds))
    for (const id of allSpecialistIds) {
      const r = rows.find((x) => x.id === id)
      if (!r || r.role !== 'specialist' || r.status !== 'active') fieldError('visits', 'specialist_invalid')
    }
  }

  const visitCount = input.visits.length
  const checkVisit = (i: number, field: string) => {
    if (i >= visitCount) fieldError(field, 'invalid')
  }

  const lines: PlannedLine[] = input.lines.map((l, idx) => {
    const field = `lines.${idx}`
    const manualPrice = { manualFinalPrice: l.manualFinalPrice, manualReason: l.manualReason }
    const price = (base: number, offer: number | null, vipEligible: boolean): LinePricing => {
      try {
        return priceLine({ basePrice: base, offerPrice: offer, vipCustomer, vipEligible, ...manualPrice })
      } catch (err) {
        if (err instanceof DomainError) throw new ValidationError('validation_failed', { [field]: err.code })
        throw err
      }
    }

    if (l.kind === 'service') {
      const s = svcRows.find((x) => x.id === l.serviceId)
      if (!s || !s.active) fieldError(field, 'invalid')
      checkVisit(l.visitIndex, field)
      if (l.beneficiaryIndex > input.personsCount) fieldError(field, 'beneficiary_invalid')
      return {
        input: l,
        kind: 'service',
        serviceId: s.id,
        packageId: null,
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        beneficiaryIndex: l.beneficiaryIndex,
        durationMinutes: s.durationMinutes,
        pricing: price(s.basePriceHalalas, s.offerPriceHalalas, true),
        vipEligible: true,
        packageSnapshot: null,
        notes: null,
        items: [{ visitIndex: l.visitIndex, nameAr: s.nameAr, nameEn: s.nameEn, componentServiceId: null, beneficiaryIndex: l.beneficiaryIndex, specialistEmployeeId: l.specialistId, taskDurationMinutes: s.durationMinutes }],
        sessionVisitIndexes: [],
      }
    }

    if (l.kind === 'custom') {
      authorize(actor, 'services.custom')
      checkVisit(l.visitIndex, field)
      if (l.beneficiaryIndex > input.personsCount) fieldError(field, 'beneficiary_invalid')
      return {
        input: l,
        kind: 'custom',
        serviceId: null,
        packageId: null,
        nameAr: l.name,
        nameEn: l.name,
        beneficiaryIndex: l.beneficiaryIndex,
        durationMinutes: l.durationMinutes,
        pricing: price(l.priceHalalas, null, l.vipEligible),
        vipEligible: l.vipEligible,
        packageSnapshot: null,
        notes: l.notes,
        items: [{ visitIndex: l.visitIndex, nameAr: l.name, nameEn: l.name, componentServiceId: null, beneficiaryIndex: l.beneficiaryIndex, specialistEmployeeId: l.specialistId, taskDurationMinutes: l.durationMinutes }],
        sessionVisitIndexes: [],
      }
    }

    const p = pkgRows.find((x) => x.id === l.packageId)
    if (!p || !p.active) fieldError(field, 'invalid')
    if (l.visitIndexes.length !== p.visitsCount || new Set(l.visitIndexes).size !== p.visitsCount) fieldError(field, 'package_visits_invalid')
    l.visitIndexes.forEach((v) => checkVisit(v, field))
    if (p.personsCount > input.personsCount) fieldError('personsCount', 'package_persons')
    const components = compRows.filter((c) => c.c.packageId === p.id)
    const items: PlannedItem[] = []
    for (const v of l.visitIndexes) {
      for (const c of components) {
        for (let q = 0; q < c.c.quantity; q++) {
          items.push({
            visitIndex: v,
            nameAr: c.nameAr,
            nameEn: c.nameEn,
            componentServiceId: c.c.serviceId,
            // Multi-person packages: each unit of a component is for the next beneficiary.
            beneficiaryIndex: p.personsCount > 1 ? (q % p.personsCount) + 1 : 1,
            specialistEmployeeId: null,
            taskDurationMinutes: c.c.taskDurationMinutes,
          })
        }
      }
    }
    return {
      input: l,
      kind: 'package',
      serviceId: null,
      packageId: p.id,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      beneficiaryIndex: null,
      durationMinutes: p.visitDurationMinutes,
      pricing: price(p.basePriceHalalas, p.offerPriceHalalas, vipOnPackages),
      vipEligible: vipOnPackages,
      packageSnapshot: {
        code: p.code,
        personsCount: p.personsCount,
        visitsCount: p.visitsCount,
        visitDurationMinutes: p.visitDurationMinutes,
        specialistsPerVisit: p.specialistsPerVisit,
        components: components.map((c) => ({ serviceId: c.c.serviceId, nameAr: c.nameAr, nameEn: c.nameEn, quantity: c.c.quantity, taskDurationMinutes: c.c.taskDurationMinutes })),
      },
      notes: null,
      items,
      sessionVisitIndexes: l.visitIndexes,
    }
  })

  // Price permissions: manual change needs pricing.adjust; a free line needs pricing.free.
  for (const l of lines) {
    if (l.pricing.manualAdjustment !== 0) authorize(actor, 'pricing.adjust')
    if (l.pricing.isFree) authorize(actor, 'pricing.free')
  }

  // Visits.
  const planned: PlannedVisit[] = []
  for (const [i, v] of input.visits.entries()) {
    const field = `visits.${i}`
    const specialistIds = [...new Set(v.specialistIds)]
    const visitItemsList = lines.flatMap((l) => l.items.filter((it) => it.visitIndex === i))
    if (visitItemsList.length === 0) fieldError(field, 'visit_empty')

    // Auto-assign the only specialist; otherwise the chosen specialist must be booked on the visit.
    for (const l of lines) {
      for (const it of l.items) {
        if (it.visitIndex !== i || l.kind === 'package') continue
        if (it.specialistEmployeeId && !specialistIds.includes(it.specialistEmployeeId)) fieldError(field, 'item_specialist_not_in_visit')
        if (!it.specialistEmployeeId && specialistIds.length === 1) it.specialistEmployeeId = specialistIds[0]!
      }
    }

    let startsAt: Date | null = null
    if (v.date || v.time) {
      if (!v.date || !v.time) fieldError(field, 'datetime_incomplete')
      startsAt = riyadhLocalToInstant(v.date, v.time)
      if (!isAllowedStartTime(startsAt)) fieldError(field, 'outside_hours')
      if (isDayOff(operationalDateOf(startsAt), daysOff)) fieldError(field, 'day_off')
      if ((await employeesOffOn(db, specialistIds, operationalDateOf(startsAt))).size > 0) fieldError(field, 'specialist_day_off')
    }
    const declared = lines.filter((l) => l.kind === 'package' && l.sessionVisitIndexes.includes(i)).map((l) => l.durationMinutes)
    const tasks = lines.flatMap((l) => (l.kind === 'package' ? [] : l.items.filter((it) => it.visitIndex === i))).map((it) => ({ specialistId: it.specialistEmployeeId, taskMinutes: it.taskDurationMinutes }))
    const durationMinutes = v.durationMinutes ?? suggestedVisitMinutes(tasks, declared)

    if (opts.confirm) {
      const onlyLaterPackageSessions = lines.every((l) => {
        const here = l.items.some((it) => it.visitIndex === i)
        return !here || (l.kind === 'package' && l.sessionVisitIndexes.indexOf(i) > 0)
      })
      if (!startsAt && !onlyLaterPackageSessions) fieldError(field, 'schedule_required')
      if (startsAt && specialistIds.length === 0) fieldError(field, 'specialists_required')
      if (startsAt) {
        for (const l of lines) {
          if (l.kind !== 'package' && l.items.some((it) => it.visitIndex === i && !it.specialistEmployeeId)) fieldError(field, 'item_specialist_required')
        }
      }
    }
    planned.push({ sequence: i + 1, startsAt, operationalDate: startsAt ? operationalDateOf(startsAt) : null, durationMinutes, specialistIds, notes: v.notes })
  }

  if (opts.confirm && lines.length === 0) fieldError('lines', 'required')
  const totals = orderTotals(
    lines.map((l) => l.pricing.finalPrice),
    deliveryFee,
  )
  return { lines, visits: planned, servicesTotal: totals.servicesTotal, deliveryFee, grandTotal: totals.grandTotal, vipAtBooking: vipCustomer, addressSnapshot }
}

async function resolveModerator(db: Executor, actor: Actor, requested: string | null): Promise<string | null> {
  const id = requested ?? (actor.role === 'moderator' ? actor.employeeId : null)
  if (!id) return null
  const [e] = await db.select({ role: employees.role, status: employees.status }).from(employees).where(eq(employees.id, id))
  if (!e || e.status !== 'active' || !['moderator', 'owner', 'admin_manager'].includes(e.role)) fieldError('moderatorEmployeeId', 'invalid')
  return id
}

async function nextReference(db: Executor): Promise<string> {
  const res = await db.execute<{ n: string }>(sql`SELECT nextval('order_reference_seq')::text AS n`)
  return formatOrderReference(riyadhToday(), Number(res.rows[0]!.n))
}

function conflictToValidation(err: unknown): never {
  if (pgErrorCode(err) === '23P01') throw new ValidationError('specialist_conflict')
  throw err
}

// ─────────────────────────────── Save draft / confirm ───────────────────────────────

/**
 * Create or update a DRAFT order, optionally confirming it. The whole draft (lines, visits,
 * items) is rebuilt from the input inside one transaction; prices are always recomputed from
 * the catalog snapshot so discounts can never stack. Confirmation reserves the specialists.
 */
export async function saveOrder(actor: Actor, orderId: string | null, rawInput: unknown, opts: { confirm: boolean }): Promise<{ id: string; reference: string; status: Order['status'] }> {
  authorize(actor, 'orders.manage')
  const input = parseWith(orderInputSchema, rawInput)
  const db = getDb()
  try {
    return await db.transaction(async (tx) => {
      let existing: Order | undefined
      if (orderId) {
        ;[existing] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
        if (!existing) throw new NotFoundError()
        if (existing.status !== 'draft') throw new ValidationError('order_not_draft')
      }
      const plan = await planOrder(tx, actor, input, { confirm: opts.confirm })
      const moderatorId = await resolveModerator(tx, actor, input.moderatorEmployeeId)
      const now = new Date()
      const header = {
        customerId: input.customerId,
        addressId: input.addressId,
        addressSnapshot: plan.addressSnapshot,
        personsCount: input.personsCount,
        moderatorEmployeeId: moderatorId,
        vipAtBooking: plan.vipAtBooking,
        deliveryFeeHalalas: plan.deliveryFee,
        servicesTotalHalalas: plan.servicesTotal,
        grandTotalHalalas: plan.grandTotal,
        notes: input.notes,
        status: opts.confirm ? ('confirmed' as const) : ('draft' as const),
        ...(opts.confirm ? { confirmedAt: now, confirmedByUserId: actor.userId, commissionRules: COMMISSION_RULES_V1 } : {}),
        updatedAt: now,
      }

      let order: Order
      if (existing) {
        await tx.delete(orderLines).where(eq(orderLines.orderId, existing.id))
        await tx.delete(visits).where(eq(visits.orderId, existing.id))
        ;[order] = (await tx.update(orders).set(header).where(eq(orders.id, existing.id)).returning()) as [Order]
      } else {
        ;[order] = (await tx
          .insert(orders)
          .values({ ...header, reference: await nextReference(tx), createdByUserId: actor.userId })
          .returning()) as [Order]
      }

      // The order keeps its own reference to the building photo (history does not change later).
      const [addrPhoto] = input.addressId
        ? await tx.select({ full: customerAddresses.photoFileId, thumb: customerAddresses.photoThumbFileId }).from(customerAddresses).where(eq(customerAddresses.id, input.addressId))
        : []
      await tx.update(orders).set({ buildingPhotoFileId: addrPhoto?.full ?? null, buildingPhotoThumbFileId: addrPhoto?.thumb ?? null }).where(eq(orders.id, order.id))

      if ((existing?.moderatorEmployeeId ?? null) !== moderatorId) {
        await tx.insert(orderModeratorChanges).values({ orderId: order.id, fromEmployeeId: existing?.moderatorEmployeeId ?? null, toEmployeeId: moderatorId, changedByUserId: actor.userId })
      }

      const visitIds: string[] = []
      for (const v of plan.visits) {
        const [row] = await tx
          .insert(visits)
          .values({ orderId: order.id, sequence: v.sequence, status: v.startsAt ? 'scheduled' : 'unscheduled', startsAt: v.startsAt, operationalDate: v.operationalDate, durationMinutes: v.durationMinutes, notes: v.notes })
          .returning()
        visitIds.push(row!.id)
        for (const sid of v.specialistIds) {
          const endsAt = v.startsAt ? new Date(v.startsAt.getTime() + v.durationMinutes * 60_000) : null
          await tx.insert(visitSpecialists).values({ visitId: row!.id, employeeId: sid, startsAt: v.startsAt, endsAt, blocking: opts.confirm && v.startsAt != null })
        }
      }

      for (const [i, l] of plan.lines.entries()) {
        const [line] = await tx
          .insert(orderLines)
          .values({
            orderId: order.id,
            kind: l.kind,
            serviceId: l.serviceId,
            packageId: l.packageId,
            nameAr: l.nameAr,
            nameEn: l.nameEn,
            beneficiaryIndex: l.beneficiaryIndex,
            durationMinutes: l.durationMinutes,
            basePriceHalalas: l.pricing.basePrice,
            offerPriceHalalas: l.pricing.offerPrice,
            vipEligible: l.vipEligible,
            vipDiscountHalalas: l.pricing.vipDiscount,
            priceAfterVipHalalas: l.pricing.priceAfterVip,
            manualFinalPriceHalalas: l.input.manualFinalPrice,
            manualReason: l.pricing.manualReason,
            manualByUserId: l.input.manualFinalPrice != null ? actor.userId : null,
            finalPriceHalalas: l.pricing.finalPrice,
            packageSnapshot: l.packageSnapshot,
            notes: l.notes,
            sortOrder: i,
          })
          .returning()
        for (const [j, it] of l.items.entries()) {
          await tx.insert(visitItems).values({
            visitId: visitIds[it.visitIndex]!,
            orderLineId: line!.id,
            componentServiceId: it.componentServiceId,
            nameAr: it.nameAr,
            nameEn: it.nameEn,
            beneficiaryIndex: it.beneficiaryIndex,
            specialistEmployeeId: it.specialistEmployeeId,
            taskDurationMinutes: it.taskDurationMinutes,
            sortOrder: j,
          })
        }
        for (const [s, vi] of l.sessionVisitIndexes.entries()) {
          await tx.insert(packageSessions).values({ orderLineId: line!.id, sessionNumber: s + 1, visitId: visitIds[vi]! })
        }
        if (l.pricing.manualAdjustment !== 0) {
          await writeAudit(tx, {
            actorUserId: actor.userId,
            action: 'order.line_price_manual',
            entityType: 'order',
            entityId: order.id,
            after: { line: l.nameEn, priceAfterVip: l.pricing.priceAfterVip, final: l.pricing.finalPrice, adjustment: l.pricing.manualAdjustment },
            reason: l.pricing.manualReason,
          })
        }
      }

      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: opts.confirm ? 'order.confirm' : existing ? 'order.draft_update' : 'order.draft_create',
        entityType: 'order',
        entityId: order.id,
        after: { reference: order.reference, servicesTotalHalalas: plan.servicesTotal, deliveryFeeHalalas: plan.deliveryFee, grandTotalHalalas: plan.grandTotal, vipAtBooking: plan.vipAtBooking },
      })
      // Booking confirmation + a reminder three hours before each scheduled visit (spec §13).
      if (opts.confirm) await syncMessageTasks(tx, order.id)
      if (opts.confirm) {
        // Tell each reserved specialist about her new booking (in her own language).
        for (const v of await tx.select({ id: visits.id }).from(visits).where(eq(visits.orderId, order.id))) await notifyVisitChanges(tx, v.id, NOBODY, actor.userId)
      }
      return { id: order.id, reference: order.reference, status: order.status }
    })
  } catch (err) {
    conflictToValidation(err)
  }
}

// ─────────────────────────────── Changes to confirmed orders ───────────────────────────────

async function lockVisit(tx: Executor, visitId: string) {
  if (!z.uuid().safeParse(visitId).success) throw new NotFoundError()
  const [row] = await tx.select({ v: visits, o: orders }).from(visits).innerJoin(orders, eq(orders.id, visits.orderId)).where(eq(visits.id, visitId)).for('update')
  if (!row) throw new NotFoundError()
  return row
}

async function refreshOrderStatus(tx: Executor, orderId: string) {
  const vs = await tx.select({ status: visits.status }).from(visits).where(eq(visits.orderId, orderId))
  const [o] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId))
  if (!o || o.status === 'draft' || o.status === 'cancelled') return
  // Cancelled visits (e.g. remaining package sessions) no longer count towards completion.
  const active = vs.filter((v) => v.status !== 'cancelled')
  if (active.length === 0) return
  const next = active.some((v) => v.status === 'pending_review') ? 'pending_review' : active.every((v) => v.status === 'completed') ? 'completed' : 'confirmed'
  if (next !== o.status) await tx.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, orderId))
}

const rescheduleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().min(5).max(720),
  specialistIds: z.array(z.uuid()).min(1).max(6),
  reason: optText(500),
})

/**
 * Schedule or reschedule a visit of a confirmed order (also books a later package session).
 * Specialists are re-reserved atomically; the DB rejects overlaps.
 */
export async function rescheduleVisit(actor: Actor, visitId: string, raw: unknown) {
  authorize(actor, 'schedule.manage')
  const input = parseWith(rescheduleSchema, raw)
  const startsAt = riyadhLocalToInstant(input.date, input.time)
  if (!isAllowedStartTime(startsAt)) fieldError('time', 'outside_hours')
  if (isDayOff(operationalDateOf(startsAt), await getDaysOff(getDb()))) fieldError('date', 'day_off')
  const specialistIds = [...new Set(input.specialistIds)]
  try {
    return await getDb().transaction(async (tx) => {
      const { v, o } = await lockVisit(tx, visitId)
      if (o.status === 'draft') throw new ValidationError('order_is_draft')
      if (o.status === 'cancelled' || v.status === 'cancelled') throw new ValidationError('order_cancelled')
      if (v.status === 'completed') throw new ValidationError('visit_completed')
      const peopleBefore = await visitPeople(tx, visitId)
      const rows = await tx.select({ id: employees.id, role: employees.role, status: employees.status }).from(employees).where(inArray(employees.id, specialistIds))
      if (rows.length !== specialistIds.length || rows.some((r) => r.role !== 'specialist' || r.status !== 'active')) fieldError('specialistIds', 'specialist_invalid')
      if ((await employeesOffOn(tx, specialistIds, operationalDateOf(startsAt))).size > 0) fieldError('specialistIds', 'specialist_day_off')

      const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000)
      const before = { startsAt: v.startsAt?.toISOString() ?? null, durationMinutes: v.durationMinutes, specialists: (await tx.select({ id: visitSpecialists.employeeId }).from(visitSpecialists).where(eq(visitSpecialists.visitId, visitId))).map((r) => r.id) }
      await tx.delete(visitSpecialists).where(eq(visitSpecialists.visitId, visitId))
      for (const sid of specialistIds) await tx.insert(visitSpecialists).values({ visitId, employeeId: sid, startsAt, endsAt, blocking: true })
      await tx
        .update(visits)
        .set({ startsAt, operationalDate: operationalDateOf(startsAt), durationMinutes: input.durationMinutes, status: 'scheduled', pendingReason: null, updatedAt: new Date() })
        .where(eq(visits.id, visitId))

      // Items whose specialist left the visit: reassign to the only specialist or clear.
      const items = await tx.select().from(visitItems).where(eq(visitItems.visitId, visitId))
      for (const it of items) {
        if (it.specialistEmployeeId && !specialistIds.includes(it.specialistEmployeeId)) {
          await tx.update(visitItems).set({ specialistEmployeeId: specialistIds.length === 1 ? specialistIds[0]! : null }).where(eq(visitItems.id, it.id))
        } else if (!it.specialistEmployeeId && !it.componentServiceId && specialistIds.length === 1) {
          await tx.update(visitItems).set({ specialistEmployeeId: specialistIds[0]! }).where(eq(visitItems.id, it.id))
        }
      }
      // Driving legs keep their travel estimate and move with the visit (may raise a driver conflict).
      await syncLegsForVisit(tx, visitId)
      await refreshOrderStatus(tx, o.id)
      // The old reminder is cancelled and a new one prepared for the new time.
      await syncMessageTasks(tx, o.id)
      await notifyVisitChanges(tx, visitId, peopleBefore, actor.userId)
      await writeAudit(tx, {
        actorUserId: actor.userId,
        action: v.startsAt ? 'visit.reschedule' : 'visit.schedule',
        entityType: 'order',
        entityId: o.id,
        before,
        after: { visit: v.sequence, startsAt: startsAt.toISOString(), durationMinutes: input.durationMinutes, specialists: specialistIds },
        reason: input.reason,
      })
    })
  } catch (err) {
    conflictToValidation(err)
  }
}

/** Assign the executing specialist of an item (must be booked on that visit). */
export async function assignItemSpecialist(actor: Actor, itemId: string, specialistId: string | null) {
  authorize(actor, 'schedule.manage')
  await getDb().transaction(async (tx) => {
    const [it] = await tx.select().from(visitItems).where(eq(visitItems.id, itemId)).for('update')
    if (!it) throw new NotFoundError()
    const { v } = await lockVisit(tx, it.visitId)
    if (v.status === 'completed') throw new ValidationError('visit_completed')
    if (specialistId) {
      const [booked] = await tx.select().from(visitSpecialists).where(and(eq(visitSpecialists.visitId, it.visitId), eq(visitSpecialists.employeeId, specialistId)))
      if (!booked) fieldError('specialistId', 'item_specialist_not_in_visit')
    }
    await tx.update(visitItems).set({ specialistEmployeeId: specialistId }).where(eq(visitItems.id, itemId))
  })
}

/**
 * Mark a visit as executed. Idempotent (a second tap changes nothing). Specialists may
 * complete only visits they are booked on; operations staff may complete any.
 */
export async function completeVisit(actor: Actor, visitId: string) {
  await getDb().transaction(async (tx) => {
    const { v, o } = await lockVisit(tx, visitId)
    if (!can(actor, 'schedule.manage')) {
      if (!can(actor, 'schedule.read.own')) throw new ForbiddenError('schedule.manage')
      const [mine] = await tx.select().from(visitSpecialists).where(and(eq(visitSpecialists.visitId, visitId), eq(visitSpecialists.employeeId, actor.employeeId)))
      if (!mine) throw new ForbiddenError('schedule.read.own')
    }
    if (v.status === 'completed') return
    if (v.status !== 'scheduled' || o.status === 'draft') throw new ValidationError('visit_not_scheduled')
    await tx.update(visits).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(visits.id, visitId))
    await refreshOrderStatus(tx, o.id)
    await syncCommissions(tx, o.id)
    await syncMessageTasks(tx, o.id)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'visit.complete', entityType: 'order', entityId: o.id, after: { visit: v.sequence } })
  })
}

/**
 * Could not be executed: keep the record for management review. It is not counted as
 * executed, payments are untouched, and the specialists' time is released.
 */
export async function markVisitPendingReview(actor: Actor, visitId: string, reason: string) {
  authorize(actor, 'schedule.manage')
  const why = reason?.trim()
  if (!why) fieldError('reason', 'required')
  await getDb().transaction(async (tx) => {
    const { v, o } = await lockVisit(tx, visitId)
    if (v.status === 'completed') throw new ValidationError('visit_completed')
    if (o.status === 'draft') throw new ValidationError('order_is_draft')
    if (o.status === 'cancelled' || v.status === 'cancelled') throw new ValidationError('order_cancelled')
    await tx.update(visits).set({ status: 'pending_review', pendingReason: why, updatedAt: new Date() }).where(eq(visits.id, visitId))
    await tx.update(visitSpecialists).set({ blocking: false }).where(eq(visitSpecialists.visitId, visitId))
    await syncLegsForVisit(tx, visitId)
    await refreshOrderStatus(tx, o.id)
    await syncMessageTasks(tx, o.id)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'visit.pending_review', entityType: 'order', entityId: o.id, after: { visit: v.sequence }, reason: why })
  })
}

/** Manual final price of one line after confirmation (recomputed from snapshots, audited). */
export async function adjustLinePrice(actor: Actor, lineId: string, manualFinalPrice: number | null, reason: string | null) {
  authorize(actor, 'pricing.adjust')
  await getDb().transaction(async (tx) => {
    const [line] = await tx.select().from(orderLines).where(eq(orderLines.id, lineId)).for('update')
    if (!line) throw new NotFoundError()
    const [o] = await tx.select().from(orders).where(eq(orders.id, line.orderId)).for('update')
    if (!o || o.status === 'draft') throw new ValidationError('order_is_draft')
    if (o.status === 'completed') throw new ValidationError('order_completed')
    if (o.status === 'cancelled') throw new ValidationError('order_cancelled')
    let pricing: LinePricing
    try {
      pricing = priceLine({ basePrice: line.basePriceHalalas, offerPrice: line.offerPriceHalalas, vipCustomer: o.vipAtBooking, vipEligible: line.vipEligible, manualFinalPrice, manualReason: reason })
    } catch (err) {
      if (err instanceof DomainError) throw new ValidationError('validation_failed', { price: err.code })
      throw err
    }
    if (pricing.isFree) authorize(actor, 'pricing.free')
    await tx
      .update(orderLines)
      .set({ manualFinalPriceHalalas: manualFinalPrice, manualReason: pricing.manualReason, manualByUserId: actor.userId, finalPriceHalalas: pricing.finalPrice, vipDiscountHalalas: pricing.vipDiscount, priceAfterVipHalalas: pricing.priceAfterVip })
      .where(eq(orderLines.id, lineId))
    await recalcTotals(tx, o.id)
    await reviewOpenLinksAfterPriceChange(tx, o.id)
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: 'order.line_price_manual',
      entityType: 'order',
      entityId: o.id,
      before: { line: line.nameEn, final: line.finalPriceHalalas },
      after: { line: line.nameEn, final: pricing.finalPrice },
      reason: pricing.manualReason,
    })
  })
}

async function recalcTotals(tx: Executor, orderId: string) {
  const lines = await tx.select({ p: orderLines.finalPriceHalalas }).from(orderLines).where(eq(orderLines.orderId, orderId))
  const [o] = await tx.select({ fee: orders.deliveryFeeHalalas }).from(orders).where(eq(orders.id, orderId))
  const t = orderTotals(
    lines.map((l) => l.p),
    o!.fee,
  )
  await tx.update(orders).set({ servicesTotalHalalas: t.servicesTotal, grandTotalHalalas: t.grandTotal, updatedAt: new Date() }).where(eq(orders.id, orderId))
}

export async function setDeliveryFee(actor: Actor, orderId: string, fee: number) {
  authorize(actor, 'orders.manage')
  try {
    validateDeliveryFee(fee)
  } catch (err) {
    if (err instanceof DomainError) throw new ValidationError('validation_failed', { deliveryFeeHalalas: err.code })
    throw err
  }
  await getDb().transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
    if (!o) throw new NotFoundError()
    if (o.status === 'completed') throw new ValidationError('order_completed')
    if (o.status === 'cancelled') throw new ValidationError('order_cancelled')
    await tx.update(orders).set({ deliveryFeeHalalas: fee }).where(eq(orders.id, orderId))
    await recalcTotals(tx, orderId)
    await reviewOpenLinksAfterPriceChange(tx, orderId)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'order.delivery_fee', entityType: 'order', entityId: orderId, before: { fee: o.deliveryFeeHalalas }, after: { fee } })
  })
}

export async function changeOrderModerator(actor: Actor, orderId: string, employeeId: string | null, reason: string | null) {
  authorize(actor, 'orders.manage')
  await getDb().transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
    if (!o) throw new NotFoundError()
    const next = employeeId ? await resolveModerator(tx, actor, employeeId) : null
    if (next === o.moderatorEmployeeId) return
    await tx.update(orders).set({ moderatorEmployeeId: next, updatedAt: new Date() }).where(eq(orders.id, orderId))
    await tx.insert(orderModeratorChanges).values({ orderId, fromEmployeeId: o.moderatorEmployeeId, toEmployeeId: next, changedByUserId: actor.userId, reason })
    await writeAudit(tx, { actorUserId: actor.userId, action: 'order.moderator_change', entityType: 'order', entityId: orderId, before: { moderator: o.moderatorEmployeeId }, after: { moderator: next }, reason })
  })
}

export async function updateOrderNotes(actor: Actor, orderId: string, notes: string | null) {
  authorize(actor, 'orders.manage')
  const value = notes?.trim().slice(0, 2000) || null
  const [o] = await getDb().update(orders).set({ notes: value, updatedAt: new Date() }).where(eq(orders.id, orderId)).returning({ id: orders.id })
  if (!o) throw new NotFoundError()
}

// ─────────────────────────────── Queries ───────────────────────────────

export interface OrderFilters {
  q?: string
  status?: string
  from?: string
  to?: string
}

export async function listOrders(actor: Actor, filters: OrderFilters = {}) {
  authorize(actor, 'orders.read.all')
  const db = getDb()
  const conds: SQL[] = []
  if (filters.status && (['draft', 'confirmed', 'completed', 'pending_review'] as const).includes(filters.status as 'draft')) {
    conds.push(eq(orders.status, filters.status as 'draft'))
  }
  const q = filters.q?.trim()
  if (q) {
    const e164 = normalizePhone(q)
    const like = `%${q.replace(/[%_]/g, '')}%`
    conds.push(or(ilike(orders.reference, like), ilike(customers.name, like), ...(e164 ? [eq(customers.phoneE164, e164)] : []))!)
  }
  // Date filters apply to the operational date of any visit.
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) {
    conds.push(sql`EXISTS (SELECT 1 FROM ${visits} v WHERE v.order_id = ${orders.id} AND v.operational_date >= ${filters.from})`)
  }
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
    conds.push(sql`EXISTS (SELECT 1 FROM ${visits} v WHERE v.order_id = ${orders.id} AND v.operational_date <= ${filters.to})`)
  }
  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      grandTotalHalalas: orders.grandTotalHalalas,
      createdAt: orders.createdAt,
      customerName: customers.name,
      customerPhone: customers.phoneE164,
      firstStart: sql<Date | null>`(SELECT min(v.starts_at) FROM ${visits} v WHERE v.order_id = ${orders.id} AND v.status IN ('scheduled','completed'))`.mapWith((v) => (v ? new Date(v as string) : null)),
      visitCount: sql<number>`(SELECT count(*) FROM ${visits} v WHERE v.order_id = ${orders.id})`.mapWith(Number),
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(200)
  return rows
}

export interface OrderDetail {
  order: Order
  buildingPhotoUrl: string | null
  customer: typeof customers.$inferSelect
  moderatorName: string | null
  lines: (typeof orderLines.$inferSelect & { sessions: { sessionNumber: number; visitId: string }[]; balance: SessionBalance | null })[]
  visits: (typeof visits.$inferSelect & {
    specialists: { id: string; name: string }[]
    items: (typeof visitItems.$inferSelect & { specialistName: string | null })[]
  })[]
  moderatorHistory: { changedAt: Date; toName: string | null; fromName: string | null; reason: string | null }[]
}

function empName(e: { fullName: string; displayNameEn: string | null } | undefined, locale: 'ar' | 'en') {
  if (!e) return null
  return locale === 'en' && e.displayNameEn ? e.displayNameEn : e.fullName
}

export async function getOrderDetail(actor: Actor, orderId: string): Promise<OrderDetail> {
  authorize(actor, 'orders.read.all')
  if (!z.uuid().safeParse(orderId).success) throw new NotFoundError()
  const db = getDb()
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw new NotFoundError()
  const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId))
  const addr = { photo: order.buildingPhotoFileId }
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(asc(orderLines.sortOrder))
  const vs = await db.select().from(visits).where(eq(visits.orderId, orderId)).orderBy(asc(visits.sequence))
  const visitIds = vs.map((v) => v.id)
  const specs = visitIds.length ? await db.select().from(visitSpecialists).where(inArray(visitSpecialists.visitId, visitIds)) : []
  const items = visitIds.length ? await db.select().from(visitItems).where(inArray(visitItems.visitId, visitIds)).orderBy(asc(visitItems.sortOrder)) : []
  const sessions = lines.length ? await db.select().from(packageSessions).where(inArray(packageSessions.orderLineId, lines.map((l) => l.id))) : []
  const history = await db.select().from(orderModeratorChanges).where(eq(orderModeratorChanges.orderId, orderId)).orderBy(asc(orderModeratorChanges.changedAt))
  const empIds = [...new Set([...specs.map((s) => s.employeeId), ...items.flatMap((i) => (i.specialistEmployeeId ? [i.specialistEmployeeId] : [])), ...(order.moderatorEmployeeId ? [order.moderatorEmployeeId] : []), ...history.flatMap((h) => [h.fromEmployeeId, h.toEmployeeId].filter((x): x is string => !!x))])]
  const emps = empIds.length ? await db.select({ id: employees.id, fullName: employees.fullName, displayNameEn: employees.displayNameEn }).from(employees).where(inArray(employees.id, empIds)) : []
  const name = (id: string | null) => (id ? empName(emps.find((e) => e.id === id), actor.locale) : null)

  return {
    order,
    buildingPhotoUrl: addr?.photo ? `/api/files/${addr.photo}` : null,
    customer: customer!,
    moderatorName: name(order.moderatorEmployeeId),
    lines: lines.map((l) => {
      const ls = sessions.filter((s) => s.orderLineId === l.id).sort((a, b) => a.sessionNumber - b.sessionNumber)
      return {
        ...l,
        sessions: ls.map((s) => ({ sessionNumber: s.sessionNumber, visitId: s.visitId })),
        balance: l.kind === 'package' ? packageSessionBalance(ls.length, ls.map((s) => vs.find((v) => v.id === s.visitId)!.status)) : null,
      }
    }),
    visits: vs.map((v) => ({
      ...v,
      specialists: specs.filter((s) => s.visitId === v.id).map((s) => ({ id: s.employeeId, name: name(s.employeeId) ?? '' })),
      items: items.filter((i) => i.visitId === v.id).map((i) => ({ ...i, specialistName: name(i.specialistEmployeeId) })),
    })),
    moderatorHistory: history.map((h) => ({ changedAt: h.changedAt, toName: name(h.toEmployeeId), fromName: name(h.fromEmployeeId), reason: h.reason })),
  }
}

/** Rebuild wizard input from a draft so it can be edited. */
export async function getDraftInput(actor: Actor, orderId: string): Promise<{ input: OrderInput; reference: string }> {
  authorize(actor, 'orders.manage')
  const d = await getOrderDetail(actor, orderId)
  if (d.order.status !== 'draft') throw new ValidationError('order_not_draft')
  const visitIndex = (visitId: string) => d.visits.findIndex((v) => v.id === visitId)
  const input: OrderInput = {
    customerId: d.order.customerId,
    addressId: d.order.addressId,
    personsCount: d.order.personsCount,
    moderatorEmployeeId: d.order.moderatorEmployeeId,
    deliveryFeeHalalas: d.order.deliveryFeeHalalas,
    notes: d.order.notes,
    visits: d.visits.map((v) => {
      const p = v.startsAt ? riyadhParts(v.startsAt) : null
      return {
        date: p?.date ?? null,
        time: p ? `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` : null,
        durationMinutes: v.durationMinutes,
        specialistIds: v.specialists.map((s) => s.id),
        notes: v.notes,
      }
    }),
    lines: d.lines.map((l) => {
      const item = d.visits.flatMap((v) => v.items).find((i) => i.orderLineId === l.id)
      const manual = { manualFinalPrice: l.manualFinalPriceHalalas, manualReason: l.manualReason }
      if (l.kind === 'package') return { kind: 'package' as const, packageId: l.packageId!, visitIndexes: l.sessions.map((s) => visitIndex(s.visitId)), ...manual }
      const common = { beneficiaryIndex: l.beneficiaryIndex ?? 1, visitIndex: item ? visitIndex(item.visitId) : 0, specialistId: item?.specialistEmployeeId ?? null, ...manual }
      if (l.kind === 'service') return { kind: 'service' as const, serviceId: l.serviceId!, ...common }
      return { kind: 'custom' as const, name: l.nameAr, priceHalalas: l.basePriceHalalas, durationMinutes: l.durationMinutes, notes: l.notes, vipEligible: l.vipEligible, ...common }
    }),
  }
  return { input, reference: d.order.reference }
}

/** Active specialists for booking (names in the viewer's language). */
export async function listBookableSpecialists(actor: Actor) {
  if (!can(actor, 'orders.manage') && !can(actor, 'schedule.manage')) throw new ForbiddenError('orders.manage')
  const rows = await getDb()
    .select({ id: employees.id, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
    .from(employees)
    .where(and(eq(employees.role, 'specialist'), eq(employees.status, 'active')))
    .orderBy(asc(employees.createdAt))
  return rows.map((r) => ({ id: r.id, name: empName(r, actor.locale)! }))
}

export async function listModerators(actor: Actor) {
  authorize(actor, 'orders.manage')
  const rows = await getDb()
    .select({ id: employees.id, fullName: employees.fullName, displayNameEn: employees.displayNameEn, role: employees.role })
    .from(employees)
    .where(and(inArray(employees.role, ['moderator', 'owner', 'admin_manager']), eq(employees.status, 'active')))
    .orderBy(asc(employees.createdAt))
  return rows.map((r) => ({ id: r.id, name: empName(r, actor.locale)!, role: r.role }))
}

/**
 * A specialist's own visits in a date window: only what she needs to do the job —
 * time, address, her items and notes. No prices, no other staff's commissions.
 */
export async function mySchedule(actor: Actor, fromDate: string, toDate: string) {
  authorize(actor, 'schedule.read.own')
  const db = getDb()
  const rows = await db
    .select({ v: visits, o: orders, customerName: customers.name, photoFileId: orders.buildingPhotoFileId })
    .from(visitSpecialists)
    .innerJoin(visits, eq(visits.id, visitSpecialists.visitId))
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(customerAddresses, eq(customerAddresses.id, orders.addressId))
    .where(
      and(
        eq(visitSpecialists.employeeId, actor.employeeId),
        inArray(orders.status, ['confirmed', 'completed', 'pending_review']),
        inArray(visits.status, ['scheduled', 'completed']),
        gte(visits.operationalDate, fromDate),
        lte(visits.operationalDate, toDate),
      ),
    )
    .orderBy(asc(visits.startsAt))
  if (!rows.length) return []
  const visitIds = rows.map((r) => r.v.id)
  const items = await db.select().from(visitItems).where(inArray(visitItems.visitId, visitIds)).orderBy(asc(visitItems.sortOrder))
  const specs = await db
    .select({ visitId: visitSpecialists.visitId, id: employees.id, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
    .from(visitSpecialists)
    .innerJoin(employees, eq(employees.id, visitSpecialists.employeeId))
    .where(inArray(visitSpecialists.visitId, visitIds))
  const balances = new Map<string, number>()
  for (const id of new Set(rows.map((r) => r.o.id))) balances.set(id, (await orderBalance(db, id)).remaining)
  return rows.map((r) => ({
    visitId: r.v.id,
    orderId: r.o.id,
    /** Amount the customer still has to pay (what to collect) — not a price breakdown. */
    remainingHalalas: balances.get(r.o.id) ?? 0,
    reference: r.o.reference,
    status: r.v.status,
    startsAt: r.v.startsAt!,
    durationMinutes: r.v.durationMinutes,
    customerName: r.customerName,
    personsCount: r.o.personsCount,
    address: r.o.addressSnapshot as { district: string; addressLine: string | null; buildingDetails: string | null; accessInstructions: string | null; latitude: number | null; longitude: number | null } | null,
    buildingPhotoUrl: r.photoFileId ? `/api/files/${r.photoFileId}` : null,
    notes: r.v.notes,
    team: specs.filter((s) => s.visitId === r.v.id && s.id !== actor.employeeId).map((s) => empName(s, actor.locale)!),
    items: items
      .filter((i) => i.visitId === r.v.id)
      .map((i) => ({ name: actor.locale === 'en' ? i.nameEn : i.nameAr, beneficiaryIndex: i.beneficiaryIndex, minutes: i.taskDurationMinutes, mine: i.specialistEmployeeId === actor.employeeId, unassigned: i.specialistEmployeeId == null })),
  }))
}

/** Today's (operational day) visits for operations staff. */
export async function visitsOnOperationalDate(actor: Actor, date: string) {
  authorize(actor, 'orders.read.all')
  return getDb()
    .select({ visitId: visits.id, orderId: orders.id, reference: orders.reference, startsAt: visits.startsAt, durationMinutes: visits.durationMinutes, status: visits.status, customerName: customers.name })
    .from(visits)
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(visits.operationalDate, date), inArray(orders.status, ['confirmed', 'completed', 'pending_review'])))
    .orderBy(asc(visits.startsAt))
}

/** Everything the booking wizard needs, filtered by the actor's permissions. */
export async function bookingContext(actor: Actor) {
  authorize(actor, 'orders.manage')
  const { getCatalog } = await import('./catalog')
  const catalog = await getCatalog(actor)
  return {
    catalog,
    specialists: await (async () => {
      const list = await listBookableSpecialists(actor)
      const today = riyadhToday()
      const until = new Date(`${today}T00:00:00Z`)
      until.setUTCDate(until.getUTCDate() + 120)
      const off = await offCalendar(getDb(), list.map((x) => x.id), today, until.toISOString().slice(0, 10))
      return list.map((x) => ({ ...x, off: off[x.id] ?? { weekly: [], dates: [] } }))
    })(),
    moderators: await listModerators(actor),
    vipOnPackages: await getSetting(getDb(), 'vip_applies_to_packages'),
    permissions: { adjust: can(actor, 'pricing.adjust'), free: can(actor, 'pricing.free'), custom: can(actor, 'services.custom') },
  }
}

// ─────────────────────────────── Cancellation (D72) ───────────────────────────────

export const CANCEL_REASONS = ['customer_request', 'unreachable', 'specialist_unavailable', 'location_issue', 'duplicate_or_error', 'operational', 'other'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

const cancelSchema = z
  .object({ reason: z.enum(CANCEL_REASONS), note: optText(1000) })
  .refine((v) => v.reason !== 'other' || !!v.note, { path: ['note'], message: 'required' })

/** Cancel one not-yet-executed visit: release specialists and driver, tell them, stop reminders. */
async function cancelVisitTx(tx: Executor, visitId: string, reason: CancelReason, note: string | null, actorUserId: string) {
  const before = await visitPeople(tx, visitId)
  const now = new Date()
  await tx.update(visits).set({ status: 'cancelled', cancelledAt: now, cancelReason: reason, cancelNote: note, updatedAt: now }).where(eq(visits.id, visitId))
  await tx.update(visitSpecialists).set({ blocking: false }).where(eq(visitSpecialists.visitId, visitId))
  await syncLegsForVisit(tx, visitId) // legs of an inactive visit stop blocking and leave the driver's list
  await notifyVisitChanges(tx, visitId, before, actorUserId)
}

async function afterCancellation(tx: Executor, orderId: string) {
  await syncMessageTasks(tx, orderId) // old confirmations/reminders/"on the way" are cancelled
  await syncCommissions(tx, orderId) // nothing is earned for visits that were not executed
  await cancelOpenPaymentLinks(tx, orderId)
}

/**
 * Cancel a whole order (owner, manager, moderator). The order, its payments and its history
 * are kept. Money already collected is NOT refunded automatically: the order shows it as an
 * amount that needs a management decision. An order with an executed visit cannot be
 * cancelled as a whole — cancel its remaining visits instead.
 */
export async function cancelOrder(actor: Actor, orderId: string, raw: unknown) {
  authorize(actor, 'orders.cancel')
  const input = parseWith(cancelSchema, raw)
  if (!z.uuid().safeParse(orderId).success) throw new NotFoundError()
  return getDb().transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
    if (!o) throw new NotFoundError()
    if (o.status === 'cancelled') return { paidHalalas: (await orderBalance(tx, orderId)).confirmed }
    if (o.status === 'completed') throw new ValidationError('order_completed')
    const vs = await tx.select().from(visits).where(eq(visits.orderId, orderId)).for('update')
    if (vs.some((v) => v.status === 'completed')) throw new ValidationError('order_has_executed_visits')
    for (const v of vs) if (v.status !== 'cancelled') await cancelVisitTx(tx, v.id, input.reason, input.note, actor.userId)
    const now = new Date()
    await tx
      .update(orders)
      .set({ status: 'cancelled', cancelledAt: now, cancelledByUserId: actor.userId, cancelReason: input.reason, cancelNote: input.note, statusBeforeCancel: o.status, updatedAt: now })
      .where(eq(orders.id, orderId))
    await afterCancellation(tx, orderId)
    const balance = await orderBalance(tx, orderId)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'order.cancel', entityType: 'order', entityId: orderId, before: { status: o.status }, after: { status: 'cancelled', reason: input.reason, paidHalalas: balance.confirmed }, reason: input.note })
    return { paidHalalas: balance.confirmed }
  })
}

/**
 * Cancel one remaining visit of a multi-visit order (e.g. an unused package session). Executed
 * visits are untouched. If no active visit is left and none was executed, the order itself
 * becomes cancelled.
 */
export async function cancelVisit(actor: Actor, visitId: string, raw: unknown) {
  authorize(actor, 'orders.cancel')
  const input = parseWith(cancelSchema, raw)
  await getDb().transaction(async (tx) => {
    const { v, o } = await lockVisit(tx, visitId)
    if (v.status === 'cancelled') return
    if (v.status === 'completed') throw new ValidationError('visit_completed')
    if (o.status === 'draft') throw new ValidationError('order_is_draft')
    if (o.status === 'cancelled') throw new ValidationError('order_cancelled')
    await cancelVisitTx(tx, v.id, input.reason, input.note, actor.userId)
    const rest = await tx.select({ status: visits.status }).from(visits).where(eq(visits.orderId, o.id))
    if (rest.every((r) => r.status === 'cancelled')) {
      const now = new Date()
      await tx
        .update(orders)
        .set({ status: 'cancelled', cancelledAt: now, cancelledByUserId: actor.userId, cancelReason: input.reason, cancelNote: input.note, statusBeforeCancel: o.status, updatedAt: now })
        .where(eq(orders.id, o.id))
    } else {
      await refreshOrderStatus(tx, o.id)
    }
    await afterCancellation(tx, o.id)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'visit.cancel', entityType: 'order', entityId: o.id, before: { visit: v.sequence, status: v.status }, after: { reason: input.reason }, reason: input.note })
  })
}
