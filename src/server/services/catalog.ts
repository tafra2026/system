import { asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb } from '../db'
import { packageComponents, packages, serviceCategories, services } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'
import { parseWith } from './validation'

export type CatalogService = typeof services.$inferSelect & { categoryCode: string }
export interface CatalogPackage {
  id: string
  code: string
  nameAr: string
  nameEn: string
  basePriceHalalas: number
  offerPriceHalalas: number
  personsCount: number
  visitsCount: number
  visitDurationMinutes: number
  specialistsPerVisit: number
  active: boolean
  components: { serviceId: string; nameAr: string; nameEn: string; quantity: number; taskDurationMinutes: number }[]
}

/** Catalog for booking (moderator, management) and price-list management. */
export async function getCatalog(actor: Actor, opts: { includeInactive?: boolean } = {}) {
  if (!can(actor, 'orders.manage') && !can(actor, 'catalog.manage')) throw new ForbiddenError('orders.manage')
  const db = getDb()
  const categories = await db.select().from(serviceCategories).orderBy(asc(serviceCategories.sortOrder))
  const svcRows = await db
    .select({ s: services, categoryCode: serviceCategories.code })
    .from(services)
    .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .orderBy(asc(serviceCategories.sortOrder), asc(services.sortOrder))
  const pkgRows = await db.select().from(packages).orderBy(asc(packages.sortOrder))
  const comps = pkgRows.length
    ? await db
        .select({ c: packageComponents, nameAr: services.nameAr, nameEn: services.nameEn })
        .from(packageComponents)
        .innerJoin(services, eq(services.id, packageComponents.serviceId))
        .where(inArray(packageComponents.packageId, pkgRows.map((p) => p.id)))
        .orderBy(asc(packageComponents.sortOrder))
    : []
  const all = {
    categories,
    services: svcRows.map((r) => ({ ...r.s, categoryCode: r.categoryCode })) as CatalogService[],
    packages: pkgRows.map<CatalogPackage>((p) => ({
      id: p.id,
      code: p.code,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      basePriceHalalas: p.basePriceHalalas,
      offerPriceHalalas: p.offerPriceHalalas,
      personsCount: p.personsCount,
      visitsCount: p.visitsCount,
      visitDurationMinutes: p.visitDurationMinutes,
      specialistsPerVisit: p.specialistsPerVisit,
      active: p.active,
      components: comps
        .filter((c) => c.c.packageId === p.id)
        .map((c) => ({ serviceId: c.c.serviceId, nameAr: c.nameAr, nameEn: c.nameEn, quantity: c.c.quantity, taskDurationMinutes: c.c.taskDurationMinutes })),
    })),
  }
  if (opts.includeInactive) return all
  return { ...all, services: all.services.filter((s) => s.active), packages: all.packages.filter((p) => p.active) }
}

const priceFields = {
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  basePriceHalalas: z.number().int().min(0).max(10_000_000),
  offerPriceHalalas: z.number().int().min(0).max(10_000_000),
  active: z.boolean(),
}
const serviceSchema = z.object({ ...priceFields, durationMinutes: z.number().int().min(5).max(600), categoryId: z.uuid().optional() })
const packageSchema = z.object({
  ...priceFields,
  visitDurationMinutes: z.number().int().min(5).max(720),
  specialistsPerVisit: z.number().int().min(1).max(6),
})

function checkOffer(d: { basePriceHalalas: number; offerPriceHalalas: number }) {
  if (d.offerPriceHalalas > d.basePriceHalalas) throw new ValidationError('validation_failed', { offerPrice: 'offer_exceeds_base' })
}

/** Price-list change. Existing orders are unaffected (their lines hold snapshots). */
export async function updateService(actor: Actor, id: string, input: unknown) {
  authorize(actor, 'catalog.manage')
  const data = parseWith(serviceSchema, input)
  checkOffer(data)
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(services).where(eq(services.id, id)).for('update')
    if (!before) throw new NotFoundError()
    const [after] = await tx
      .update(services)
      .set({ nameAr: data.nameAr, nameEn: data.nameEn, basePriceHalalas: data.basePriceHalalas, offerPriceHalalas: data.offerPriceHalalas, durationMinutes: data.durationMinutes, active: data.active, updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: 'catalog.service_update',
      entityType: 'service',
      entityId: id,
      before: { basePriceHalalas: before.basePriceHalalas, offerPriceHalalas: before.offerPriceHalalas, durationMinutes: before.durationMinutes, active: before.active },
      after: { basePriceHalalas: after!.basePriceHalalas, offerPriceHalalas: after!.offerPriceHalalas, durationMinutes: after!.durationMinutes, active: after!.active },
    })
    return after!
  })
}

export async function createService(actor: Actor, input: unknown) {
  authorize(actor, 'catalog.manage')
  const data = parseWith(serviceSchema, input)
  checkOffer(data)
  if (!data.categoryId) throw new ValidationError('validation_failed', { categoryId: 'required' })
  return getDb().transaction(async (tx) => {
    const [svc] = await tx
      .insert(services)
      .values({ categoryId: data.categoryId!, code: `custom_${Date.now().toString(36)}`, nameAr: data.nameAr, nameEn: data.nameEn, basePriceHalalas: data.basePriceHalalas, offerPriceHalalas: data.offerPriceHalalas, durationMinutes: data.durationMinutes, active: data.active, sortOrder: 1000 })
      .returning()
    await writeAudit(tx, { actorUserId: actor.userId, action: 'catalog.service_create', entityType: 'service', entityId: svc!.id, after: { basePriceHalalas: svc!.basePriceHalalas, offerPriceHalalas: svc!.offerPriceHalalas } })
    return svc!
  })
}

export async function updatePackage(actor: Actor, id: string, input: unknown) {
  authorize(actor, 'catalog.manage')
  const data = parseWith(packageSchema, input)
  checkOffer(data)
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(packages).where(eq(packages.id, id)).for('update')
    if (!before) throw new NotFoundError()
    const [after] = await tx
      .update(packages)
      .set({ nameAr: data.nameAr, nameEn: data.nameEn, basePriceHalalas: data.basePriceHalalas, offerPriceHalalas: data.offerPriceHalalas, visitDurationMinutes: data.visitDurationMinutes, specialistsPerVisit: data.specialistsPerVisit, active: data.active, updatedAt: new Date() })
      .where(eq(packages.id, id))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: 'catalog.package_update',
      entityType: 'package',
      entityId: id,
      before: { basePriceHalalas: before.basePriceHalalas, offerPriceHalalas: before.offerPriceHalalas, visitDurationMinutes: before.visitDurationMinutes, specialistsPerVisit: before.specialistsPerVisit, active: before.active },
      after: { basePriceHalalas: after!.basePriceHalalas, offerPriceHalalas: after!.offerPriceHalalas, visitDurationMinutes: after!.visitDurationMinutes, specialistsPerVisit: after!.specialistsPerVisit, active: after!.active },
    })
    return after!
  })
}
