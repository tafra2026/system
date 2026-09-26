import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { DebouncedSearch } from '@/components/debounced-search'
import { Badge, ButtonLink, buttonStyles, Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { searchCustomers } from '@/server/services/customers'

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; vip?: string; page?: string }> }) {
  const { actor, allowed } = await pagePermission('customers.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const sp = await searchParams
  const q = (sp.q ?? '').slice(0, 100)
  const vipOnly = sp.vip === '1'
  const page = Math.max(1, Number(sp.page) || 1)
  const PAGE = 30
  const rows = await searchCustomers(actor, q, PAGE + 1, { vipOnly, page })
  const hasMore = rows.length > PAGE
  const shown = rows.slice(0, PAGE)
  const pageHref = (p: number) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(vipOnly ? { vip: '1' } : {}), page: String(p) }).toString()}`
  return (
    <div>
      <PageHeader title={t('customers.title')} subtitle={t('customers.subtitle')} actions={
          <div className="flex flex-wrap gap-2">
            {can(actor, 'vip.manage') && (
              <ButtonLink href="/customers/vip-import" variant="secondary">
                {t('vipImport.open')}
              </ButtonLink>
            )}
            <ButtonLink href={`/customers/new${q ? `?phone=${encodeURIComponent(q)}` : ''}`}>{t('customers.new')}</ButtonLink>
          </div>
        }
      />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
          <DebouncedSearch label={t('customers.searchLabel')} placeholder={t('customers.searchPlaceholder')} defaultValue={q} />
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="vip" value="1" defaultChecked={vipOnly} className="h-5 w-5 accent-[var(--color-brand-deep)]" />
            {t('customers.vipOnly')}
          </label>
          <button type="submit" className={buttonStyles.secondary}>
            {t('customers.search')}
          </button>
        </form>
        {shown.length === 0 ? (
          <EmptyState body={q || vipOnly ? t('customers.empty') : t('customers.noneYet')} action={q ? <ButtonLink href={`/customers/new?phone=${encodeURIComponent(q)}`}>{t('customers.new')}</ButtonLink> : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-3 hover:bg-cream">
                  <span className="min-w-40 flex-1 font-semibold text-ink" dir="auto">
                    {c.name}
                  </span>
                  {c.isVip && <Badge tone="brand">{t('customers.vip')}</Badge>}
                  <span className="ltr-data text-sm text-muted">{c.phoneE164}</span>
                  {c.districts && (
                    <span className="w-full text-xs text-muted" dir="auto">
                      {c.districts}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || hasMore) && (
          <nav aria-label={t('orders.pagination')} className="mt-3 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className={buttonStyles.secondary}>
                {t('orders.prev')}
              </Link>
            )}
            {hasMore && (
              <Link href={pageHref(page + 1)} className={buttonStyles.secondary}>
                {t('orders.next')}
              </Link>
            )}
          </nav>
        )}
      </Card>
    </div>
  )
}
