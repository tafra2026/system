import { Forbidden } from '@/components/forbidden'
import { Badge, Card, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatMoney } from '@/i18n/format'
import { toSarString } from '@/domain/money'
import { can } from '@/server/authz/actor'
import { requireActor } from '@/server/auth/current'
import { getCatalog } from '@/server/services/catalog'
import { NewServiceForm, PackageForm, ServiceForm } from './catalog-forms'

export default async function CatalogPage() {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  if (!can(actor, 'orders.manage') && !can(actor, 'catalog.manage')) return <Forbidden message={t('errors.forbidden')} />
  const editable = can(actor, 'catalog.manage')
  const catalog = await getCatalog(actor, { includeInactive: editable })
  const name = (x: { nameAr: string; nameEn: string }) => (actor.locale === 'en' ? x.nameEn : x.nameAr)
  const price = (base: number, offer: number) => (
    <span className="text-sm">
      <span className="font-semibold text-ink">{formatMoney(offer, actor.locale)}</span> <span className="text-xs text-muted line-through">{formatMoney(base, actor.locale)}</span>
    </span>
  )
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('catalog.title')} subtitle={editable ? t('catalog.subtitle') : t('catalog.readOnly')} />
      <Card title={t('catalog.packages')}>
        <ul className="flex flex-col gap-2">
          {catalog.packages.map((p) => (
            <li key={p.id} className="rounded-xl border border-line p-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{name(p)}</span>
                  <span className="flex items-center gap-2">
                    {!p.active && <Badge tone="warning">{t('catalog.inactive')}</Badge>}
                    {price(p.basePriceHalalas, p.offerPriceHalalas)}
                  </span>
                </summary>
                <p className="mt-2 text-xs text-muted">{t('wizard.packageInfo', { persons: p.personsCount, visits: p.visitsCount, minutes: p.visitDurationMinutes, specialists: p.specialistsPerVisit })}</p>
                <p className="text-xs text-muted">
                  {t('catalog.components')}: {p.components.map((c) => `${c.quantity > 1 ? `${c.quantity}× ` : ''}${name(c)} (${t('orders.minutes', { n: c.taskDurationMinutes })})`).join(' + ')}
                </p>
                {editable && (
                  <div className="mt-3">
                    <PackageForm id={p.id} d={{ nameAr: p.nameAr, nameEn: p.nameEn, base: toSarString(p.basePriceHalalas), offer: toSarString(p.offerPriceHalalas), active: p.active, visitDuration: p.visitDurationMinutes, specialists: p.specialistsPerVisit }} />
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      </Card>
      {catalog.categories.map((c) => (
        <Card key={c.id} title={name(c)}>
          <ul className="flex flex-col gap-2">
            {catalog.services
              .filter((s) => s.categoryId === c.id)
              .map((s) => (
                <li key={s.id} className="rounded-xl border border-line p-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span className="text-ink">
                        {name(s)} <span className="text-xs text-muted">· {t('orders.minutes', { n: s.durationMinutes })}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {!s.active && <Badge tone="warning">{t('catalog.inactive')}</Badge>}
                        {price(s.basePriceHalalas, s.offerPriceHalalas)}
                      </span>
                    </summary>
                    {editable && (
                      <div className="mt-3">
                        <ServiceForm id={s.id} d={{ nameAr: s.nameAr, nameEn: s.nameEn, base: toSarString(s.basePriceHalalas), offer: toSarString(s.offerPriceHalalas), active: s.active, duration: s.durationMinutes }} />
                      </div>
                    )}
                  </details>
                </li>
              ))}
          </ul>
        </Card>
      ))}
      {editable && (
        <Card title={t('catalog.addService')}>
          <NewServiceForm categories={catalog.categories.map((c) => ({ id: c.id, name: name(c) }))} />
        </Card>
      )}
    </div>
  )
}
