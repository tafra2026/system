import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { normalizePhone } from '@/domain/phone'
import { parseCoordinates } from '@/domain/order'
import { authorize, type Actor } from '../authz/actor'
import { writeAudit } from '../audit'
import { getDb } from '../db'
import { customerAddresses, customers, orders } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'
import { parseWith, pgErrorCode } from './validation'

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(40),
  altPhone: text(40),
  messageLocale: z.enum(['ar', 'en']).default('ar'),
  notes: text(2000),
})

function normalizeCustomerInput(input: unknown) {
  const data = parseWith(customerSchema, input)
  const phoneE164 = normalizePhone(data.phone)
  if (!phoneE164) throw new ValidationError('validation_failed', { phone: 'phone_invalid' })
  const altPhoneE164 = data.altPhone ? normalizePhone(data.altPhone) : null
  if (data.altPhone && !altPhoneE164) throw new ValidationError('validation_failed', { altPhone: 'phone_invalid' })
  return { ...data, phoneE164, altPhoneE164 }
}

/** Phone-first lookup to avoid duplicates (spec §6). */
export async function findCustomerByPhone(actor: Actor, phone: string) {
  authorize(actor, 'customers.manage')
  const e164 = normalizePhone(phone)
  if (!e164) return null
  const [c] = await getDb().select().from(customers).where(or(eq(customers.phoneE164, e164), eq(customers.altPhoneE164, e164))).limit(1)
  return c ?? null
}

export async function searchCustomers(actor: Actor, query: string, limit = 30) {
  authorize(actor, 'customers.manage')
  const q = query.trim()
  const db = getDb()
  const base = db.select().from(customers)
  if (!q) return base.orderBy(desc(customers.updatedAt)).limit(limit)
  const e164 = normalizePhone(q)
  const digits = q.replace(/\D/g, '')
  const conditions = [ilike(customers.name, `%${q.replace(/[%_]/g, '')}%`)]
  if (e164) conditions.push(eq(customers.phoneE164, e164), eq(customers.altPhoneE164, e164))
  if (digits.length >= 4) conditions.push(sql`${customers.phoneE164} LIKE ${'%' + digits.replace(/^0+/, '') + '%'}`)
  return base.where(or(...conditions)).orderBy(desc(customers.updatedAt)).limit(limit)
}

export async function createCustomer(actor: Actor, input: Record<string, unknown> & { isVip?: boolean }) {
  authorize(actor, 'customers.manage')
  const data = normalizeCustomerInput(input)
  const isVip = Boolean(input.isVip)
  if (isVip) authorize(actor, 'vip.manage')
  try {
    return await getDb().transaction(async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({ name: data.name, phoneE164: data.phoneE164, altPhoneE164: data.altPhoneE164, messageLocale: data.messageLocale, notes: data.notes, isVip, createdByUserId: actor.userId })
        .returning()
      await writeAudit(tx, { actorUserId: actor.userId, action: 'customer.create', entityType: 'customer', entityId: c!.id, after: { isVip } })
      return c!
    })
  } catch (err) {
    if (pgErrorCode(err) === '23505') throw new ValidationError('validation_failed', { phone: 'phone_exists' })
    throw err
  }
}

export async function updateCustomer(actor: Actor, id: string, input: unknown) {
  authorize(actor, 'customers.manage')
  const data = normalizeCustomerInput(input)
  try {
    const [c] = await getDb()
      .update(customers)
      .set({ name: data.name, phoneE164: data.phoneE164, altPhoneE164: data.altPhoneE164, messageLocale: data.messageLocale, notes: data.notes, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning()
    if (!c) throw new NotFoundError()
    return c
  } catch (err) {
    if (pgErrorCode(err) === '23505') throw new ValidationError('validation_failed', { phone: 'phone_exists' })
    throw err
  }
}

/** VIP status (auto 25% on offer prices of NEW pricing; existing orders keep their snapshot). */
export async function setCustomerVip(actor: Actor, id: string, isVip: boolean, reason: string | null) {
  authorize(actor, 'vip.manage')
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(customers).where(eq(customers.id, id)).for('update')
    if (!before) throw new NotFoundError()
    if (before.isVip === isVip) return
    await tx.update(customers).set({ isVip, updatedAt: new Date() }).where(eq(customers.id, id))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'customer.vip_change', entityType: 'customer', entityId: id, before: { isVip: before.isVip }, after: { isVip }, reason })
  })
}

const addressSchema = z.object({
  label: text(60),
  district: z.string().trim().min(1).max(120),
  addressLine: text(300),
  buildingDetails: text(300),
  accessInstructions: text(1000),
  location: text(1000),
})

function parseAddress(input: unknown) {
  const data = parseWith(addressSchema, input)
  const coords = data.location ? parseCoordinates(data.location) : null
  if (data.location && !coords) throw new ValidationError('validation_failed', { location: 'location_invalid' })
  return {
    label: data.label,
    district: data.district,
    addressLine: data.addressLine,
    buildingDetails: data.buildingDetails,
    accessInstructions: data.accessInstructions,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
  }
}

export async function addAddress(actor: Actor, customerId: string, input: unknown) {
  authorize(actor, 'customers.manage')
  const data = parseAddress(input)
  const db = getDb()
  const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId))
  if (!c) throw new NotFoundError()
  const [a] = await db.insert(customerAddresses).values({ customerId, ...data }).returning()
  return a!
}

export async function updateAddress(actor: Actor, addressId: string, input: unknown) {
  authorize(actor, 'customers.manage')
  const data = parseAddress(input)
  const [a] = await getDb().update(customerAddresses).set({ ...data, updatedAt: new Date() }).where(eq(customerAddresses.id, addressId)).returning()
  if (!a) throw new NotFoundError()
  return a
}

/** Addresses are archived (not deleted): orders keep a snapshot of the address they used. */
export async function archiveAddress(actor: Actor, addressId: string) {
  authorize(actor, 'customers.manage')
  await getDb().update(customerAddresses).set({ archivedAt: new Date() }).where(eq(customerAddresses.id, addressId))
}

export async function getCustomer(actor: Actor, id: string) {
  authorize(actor, 'customers.manage')
  if (!z.uuid().safeParse(id).success) throw new NotFoundError()
  const db = getDb()
  const [customer] = await db.select().from(customers).where(eq(customers.id, id))
  if (!customer) throw new NotFoundError()
  const addresses = await db
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, id), isNull(customerAddresses.archivedAt)))
    .orderBy(customerAddresses.createdAt)
  const history = await db
    .select({ id: orders.id, reference: orders.reference, status: orders.status, grandTotalHalalas: orders.grandTotalHalalas, createdAt: orders.createdAt })
    .from(orders)
    .where(eq(orders.customerId, id))
    .orderBy(desc(orders.createdAt))
  return { customer, addresses, orders: history }
}
