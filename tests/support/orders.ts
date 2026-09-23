import { eq } from 'drizzle-orm'
import { getDb } from '@/server/db'
import { packages, services } from '@/server/db/schema'
import { seedCatalog } from '@/server/seed-catalog'
import { addAddress, createCustomer } from '@/server/services/customers'
import type { Actor } from '@/server/authz/actor'

let phone = 500000000
export async function catalog() {
  const db = getDb()
  await seedCatalog(db)
  const svc = async (code: string) => (await db.select().from(services).where(eq(services.code, code)))[0]!
  const pkg = async (code: string) => (await db.select().from(packages).where(eq(packages.code, code)))[0]!
  return { svc, pkg }
}

export async function customerWithAddress(actor: Actor, opts: { vip?: boolean } = {}) {
  const c = await createCustomer(actor, { name: 'عميلة تجربة', phone: `0${++phone}`, isVip: opts.vip ?? false })
  const a = await addAddress(actor, c.id, { district: 'الروضة', addressLine: 'شارع 1', location: '21.5433, 39.1728' })
  return { customer: c, address: a }
}

export const visit = (date: string | null, time: string | null, specialistIds: string[] = [], durationMinutes: number | null = null) => ({ date, time, specialistIds, durationMinutes })
