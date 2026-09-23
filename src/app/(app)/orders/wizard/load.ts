import 'server-only'
import type { Actor } from '@/server/authz/actor'
import { bookingContext } from '@/server/services/orders'
import type { WizardContext } from './booking-wizard'

export async function loadWizardContext(actor: Actor): Promise<WizardContext> {
  const c = await bookingContext(actor)
  return {
    categories: c.catalog.categories.map((x) => ({ code: x.code, nameAr: x.nameAr, nameEn: x.nameEn })),
    services: c.catalog.services.map((s) => ({ id: s.id, categoryCode: s.categoryCode, nameAr: s.nameAr, nameEn: s.nameEn, basePriceHalalas: s.basePriceHalalas, offerPriceHalalas: s.offerPriceHalalas, durationMinutes: s.durationMinutes })),
    packages: c.catalog.packages.map((p) => ({
      id: p.id,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      basePriceHalalas: p.basePriceHalalas,
      offerPriceHalalas: p.offerPriceHalalas,
      personsCount: p.personsCount,
      visitsCount: p.visitsCount,
      visitDurationMinutes: p.visitDurationMinutes,
      specialistsPerVisit: p.specialistsPerVisit,
      components: p.components.map((x) => ({ nameAr: x.nameAr, nameEn: x.nameEn, quantity: x.quantity })),
    })),
    specialists: c.specialists,
    moderators: c.moderators.map((m) => ({ id: m.id, name: m.name })),
    vipOnPackages: c.vipOnPackages,
    permissions: c.permissions,
    defaultModeratorId: actor.role === 'moderator' ? actor.employeeId : null,
  }
}
