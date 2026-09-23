import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { inputClass } from '@/components/form-styles'
import { Badge, ButtonLink, buttonStyles, Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { searchCustomers } from '@/server/services/customers'

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; vip?: string }> }) {
  const { actor, allowed } = await pagePermission('customers.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const sp = await searchParams
  const q = (sp.q ?? '').slice(0, 100)
  const vipOnly = sp.vip === '1'
  const rows = await searchCustomers(actor, q, vipOnly ? 200 : 30, { vipOnly })
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
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium text-ink">
            {t('customers.searchLabel')}
            <input name="q" defaultValue={q} className={inputClass} placeholder={t('customers.searchPlaceholder')} inputMode="search" dir="auto" />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="vip" value="1" defaultChecked={vipOnly} className="h-5 w-5 accent-[var(--color-brand-deep)]" />
            {t('customers.vipOnly')}
          </label>
          <button type="submit" className={buttonStyles.secondary}>
            {t('customers.search')}
          </button>
        </form>
        {rows.length === 0 ? (
          <EmptyState body={q || vipOnly ? t('customers.empty') : t('customers.noneYet')} action={q ? <ButtonLink href={`/customers/new?phone=${encodeURIComponent(q)}`}>{t('customers.new')}</ButtonLink> : undefined} />
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
