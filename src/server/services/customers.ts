import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { normalizeDigits } from '@/domain/money'
import { normalizePhone } from '@/domain/phone'
import { coordinatesFromInput, isShortMapsLink } from '../integrations/maps-links'
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
/** Digits for a partial phone search: a full local number's leading 0 is dropped ("05…" → "5…"); short suffixes like "0001" stay as typed. */
function localDigits(q: string): string {
  const d = q.replace(/\D/g, '')
  return d.length >= 9 && d.startsWith('0') ? d.replace(/^0+/, '') : d
}

export async function findCustomerByPhone(actor: Actor, phone: string) {
  authorize(actor, 'customers.manage')
  const e164 = normalizePhone(phone)
  if (!e164) return null
  const [c] = await getDb().select().from(customers).where(or(eq(customers.phoneE164, e164), eq(customers.altPhoneE164, e164))).limit(1)
  return c ?? null
}

/**
 * Search by name (partial, Arabic-insensitive: أ/إ/آ=ا, ة=ه, ى=ي), phone in any common format
 * (05…, 5…, 9665…, +966…, Arabic digits, the last 4+ digits, or the second number) and district
 * (any of the customer's addresses). `vipOnly` lists VIP customers. Paged on the server.
 */
export async function searchCustomers(actor: Actor, query: string, limit = 30, opts: { vipOnly?: boolean; page?: number } = {}) {
  authorize(actor, 'customers.manage')
  const q = normalizeDigits(query).trim().slice(0, 100)
  const db = getDb()
  const conds: SQL[] = []
  if (opts.vipOnly) conds.push(eq(customers.isVip, true))
  if (q) {
    const e164 = normalizePhone(q)
    const digits = localDigits(q)
    const like = `%${q.replace(/[%_\\]/g, '')}%`
    const conditions: SQL[] = [
      sql`pm_normalize_ar(${customers.name}) LIKE pm_normalize_ar(${like})`,
      sql`EXISTS (SELECT 1 FROM ${customerAddresses} a WHERE a.customer_id = ${customers.id} AND a.archived_at IS NULL AND pm_normalize_ar(a.district) LIKE pm_normalize_ar(${like}))`,
    ]
    if (e164) conditions.push(eq(customers.phoneE164, e164), eq(customers.altPhoneE164, e164))
    if (digits.length >= 4) {
      conditions.push(sql`${customers.phoneE164} LIKE ${'%' + digits + '%'}`, sql`coalesce(${customers.altPhoneE164}, '') LIKE ${'%' + digits + '%'}`)
    }
    conds.push(or(...conditions)!)
  }
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  return db
    .select({
      id: customers.id,
      name: customers.name,
      phoneE164: customers.phoneE164,
      altPhoneE164: customers.altPhoneE164,
      isVip: customers.isVip,
      messageLocale: customers.messageLocale,
      // Qualified by hand: in a single-table select Drizzle writes columns unqualified, and inside
      // this subquery a bare "id" would silently mean the address id.
      districts: sql<string | null>`(SELECT string_agg(DISTINCT a.district, ' · ') FROM ${customerAddresses} a WHERE a.customer_id = "customers"."id" AND a.archived_at IS NULL)`,
    })
    .from(customers)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(customers.updatedAt))
    .limit(limit)
    .offset((page - 1) * limit)
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

async function parseAddress(input: unknown) {
  const data = parseWith(addressSchema, input)
  const coords = data.location ? await coordinatesFromInput(data.location) : null
  if (data.location && !coords) throw new ValidationError('validation_failed', { location: isShortMapsLink(data.location) ? 'short_link_unresolved' : 'location_invalid' })
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
  const data = await parseAddress(input)
  const db = getDb()
  const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId))
  if (!c) throw new NotFoundError()
  const [a] = await db.insert(customerAddresses).values({ customerId, ...data }).returning()
  return a!
}

export async function updateAddress(actor: Actor, addressId: string, input: unknown) {
  authorize(actor, 'customers.manage')
  const data = await parseAddress(input)
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

// ─────────────────────────────── Bulk VIP list ───────────────────────────────

export const VIP_IMPORT_MAX_LINES = 2000

export interface VipImportResult {
  /** New customers created as VIP. */
  created: { name: string; phone: string }[]
  /** Existing customers that become VIP. */
  upgraded: { name: string; phone: string }[]
  alreadyVip: number
  duplicates: number
  invalid: { line: number; reason: 'phone_invalid' | 'name_missing' }[]
  applied: boolean
}

/** One line = a name and a phone in any order, separated by comma, tab, semicolon or " - ". */
function parseVipLine(raw: string): { name: string; phone: string | null } {
  const line = normalizeDigits(raw).trim()
  const parts = line.split(/\t|,|،|;|\s[-–]\s/).map((p) => p.trim()).filter(Boolean)
  let phone: string | null = null
  const nameParts: string[] = []
  for (const p of parts) {
    const e164: string | null = phone ? null : normalizePhone(p)
    if (e164) phone = e164
    else nameParts.push(p)
  }
  if (!phone) {
    // "Sara 0551234567" without a separator: take the trailing number.
    const m = line.match(/^(.*?)[\s:]*((?:\+|00)?[\d\s-]{9,16})$/)
    const e164 = m ? normalizePhone(m[2]!) : null
    if (e164) return { name: m![1]!.trim(), phone: e164 }
  }
  return { name: nameParts.join(' ').replace(/\s+/g, ' ').slice(0, 120), phone }
}

/**
 * Mark a pasted list of customers as VIP (spec §9: VIP gets 25% of the offer price on new
 * bookings). Existing customers (found by main or second number) keep their saved name;
 * new ones are created. `apply = false` only previews — nothing is written.
 */
export async function importVipList(actor: Actor, text: string, apply: boolean): Promise<VipImportResult> {
  authorize(actor, 'customers.manage')
  authorize(actor, 'vip.manage')
  const lines = String(text ?? '').split(/\r?\n/)
  if (lines.filter((l) => l.trim()).length > VIP_IMPORT_MAX_LINES) throw new ValidationError('validation_failed', { list: 'too_many_lines' })

  const wanted = new Map<string, { name: string; line: number }>()
  const result: VipImportResult = { created: [], upgraded: [], alreadyVip: 0, duplicates: 0, invalid: [], applied: false }
  lines.forEach((raw, i) => {
    if (!raw.trim()) return
    const { name, phone } = parseVipLine(raw)
    if (!phone) return void result.invalid.push({ line: i + 1, reason: 'phone_invalid' })
    if (wanted.has(phone)) return void result.duplicates++
    wanted.set(phone, { name, line: i + 1 })
  })

  return getDb().transaction(async (tx) => {
    const phones = [...wanted.keys()]
    const existing = phones.length
      ? await tx
          .select()
          .from(customers)
          .where(or(inArray(customers.phoneE164, phones), inArray(customers.altPhoneE164, phones)))
          .for('update')
      : []
    const byPhone = new Map<string, (typeof existing)[number]>()
    for (const c of existing) {
      byPhone.set(c.phoneE164, c)
      if (c.altPhoneE164) byPhone.set(c.altPhoneE164, c)
    }
    const seen = new Set<string>()
    for (const [phone, { name, line }] of wanted) {
      const c = byPhone.get(phone)
      if (c) {
        if (seen.has(c.id)) {
          result.duplicates++
          continue
        }
        seen.add(c.id)
        if (c.isVip) result.alreadyVip++
        else result.upgraded.push({ name: c.name, phone: c.phoneE164 })
        if (apply && !c.isVip) {
          await tx.update(customers).set({ isVip: true, updatedAt: new Date() }).where(eq(customers.id, c.id))
          await writeAudit(tx, { actorUserId: actor.userId, action: 'customer.vip_change', entityType: 'customer', entityId: c.id, before: { isVip: false }, after: { isVip: true }, reason: 'VIP list import' })
        }
      } else if (!name) {
        result.invalid.push({ line, reason: 'name_missing' })
      } else {
        result.created.push({ name, phone })
        if (apply) {
          const [n] = await tx.insert(customers).values({ name, phoneE164: phone, isVip: true, messageLocale: 'ar', createdByUserId: actor.userId }).returning({ id: customers.id })
          await writeAudit(tx, { actorUserId: actor.userId, action: 'customer.create', entityType: 'customer', entityId: n!.id, after: { isVip: true }, reason: 'VIP list import' })
        }
      }
    }
    result.invalid.sort((a, b) => a.line - b.line)
    result.applied = apply
    return result
  })
}

