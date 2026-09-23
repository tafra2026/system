import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { inputClass } from '@/components/form-styles'
import { Badge, ButtonLink, buttonStyles, Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { pagePermission } from '@/server/auth/current'
import { searchCustomers } from '@/server/services/customers'

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor, allowed } = await pagePermission('customers.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const q = ((await searchParams).q ?? '').slice(0, 100)
  const rows = await searchCustomers(actor, q)
  return (
    <div>
      <PageHeader title={t('customers.title')} subtitle={t('customers.subtitle')} actions={<ButtonLink href={`/customers/new${q ? `?phone=${encodeURIComponent(q)}` : ''}`}>{t('customers.new')}</ButtonLink>} />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium text-ink">
            {t('customers.searchLabel')}
            <input name="q" defaultValue={q} className={inputClass} placeholder={t('customers.searchPlaceholder')} inputMode="search" dir="auto" />
          </label>
          <button type="submit" className={buttonStyles.secondary}>
            {t('customers.search')}
          </button>
        </form>
        {rows.length === 0 ? (
          <EmptyState body={q ? t('customers.empty') : t('customers.noneYet')} action={q ? <ButtonLink href={`/customers/new?phone=${encodeURIComponent(q)}`}>{t('customers.new')}</ButtonLink> : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-3 hover:bg-cream">
                  <span className="min-w-40 flex-1 font-semibold text-ink" dir="auto">
                    {c.name}
                  </span>
                  {c.isVip && <Badge tone="brand">{t('customers.vip')}</Badge>}
                  <span className="ltr-data text-sm text-muted">{c.phoneE164}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
