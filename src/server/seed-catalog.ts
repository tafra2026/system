import { count, eq } from 'drizzle-orm'
import type { Executor } from './db'
import { packageComponents, packages, serviceCategories, services } from './db/schema'
import { CATEGORIES, PACKAGES, SERVICES } from './catalog-data'

/** Insert the starting catalog if it is empty. Returns false when it already existed. */
export async function seedCatalog(db: Executor): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(services)
  if ((row?.value ?? 0) > 0) return false
  const categoryIds = new Map<string, string>()
  for (const [i, c] of CATEGORIES.entries()) {
    const [cat] = await db.insert(serviceCategories).values({ code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, sortOrder: i }).returning()
    categoryIds.set(c.code, cat!.id)
  }
  const serviceIds = new Map<string, string>()
  for (const [i, s] of SERVICES.entries()) {
    const [svc] = await db
      .insert(services)
      .values({ categoryId: categoryIds.get(s.category)!, code: s.code, nameAr: s.nameAr, nameEn: s.nameEn, basePriceHalalas: s.base * 100, offerPriceHalalas: s.offer * 100, durationMinutes: s.minutes, sortOrder: i })
      .returning()
    serviceIds.set(s.code, svc!.id)
  }
  for (const [i, p] of PACKAGES.entries()) {
    const [pkg] = await db
      .insert(packages)
      .values({
        code: p.code,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        basePriceHalalas: p.base * 100,
        offerPriceHalalas: p.offer * 100,
        personsCount: p.persons,
        visitsCount: p.visits,
        visitDurationMinutes: p.visitMinutes,
        specialistsPerVisit: p.specialistsPerVisit,
        sortOrder: i,
      })
      .returning()
    for (const [j, c] of p.components.entries()) {
      await db.insert(packageComponents).values({ packageId: pkg!.id, serviceId: serviceIds.get(c.service)!, quantity: c.quantity, taskDurationMinutes: c.taskMinutes, sortOrder: j })
    }
  }
  return true
}

export async function serviceIdByCode(db: Executor, code: string): Promise<string> {
  const [s] = await db.select({ id: services.id }).from(services).where(eq(services.code, code))
  if (!s) throw new Error(`service ${code} not found`)
  return s.id
}
