import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatMoney } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { listStaff } from '@/server/services/staff'

const statusTone = { active: 'success', inactive: 'warning', archived: 'neutral' } as const
const accountTone = { active: 'success', pending: 'warning', suspended: 'danger' } as const

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const { actor, allowed } = await pagePermission('staff.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const showArchived = (await searchParams).archived === '1'
  const staff = await listStaff(actor, { includeArchived: showArchived })
  const nameOf = (s: (typeof staff)[number]) => (actor.locale === 'en' && s.displayNameEn ? s.displayNameEn : s.fullName)

  return (
    <div>
      <PageHeader title={t('staff.title')} subtitle={t('staff.subtitle')} actions={<ButtonLink href="/staff/new">{t('staff.add')}</ButtonLink>} />
      <Card>
        <div className="mb-3 flex justify-end">
          <Link href={showArchived ? '/staff' : '/staff?archived=1'} className="text-sm font-medium text-brand-deep underline-offset-4 hover:underline">
            {showArchived ? t('staff.hideArchived') : t('staff.showArchived')}
          </Link>
        </div>
        {staff.length === 0 ? (
          <EmptyState body={t('staff.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {staff.map((s) => (
              <li key={s.id}>
                <Link href={`/staff/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-3 hover:bg-cream">
                  <div className="min-w-40 flex-1">
                    <p className="font-semibold text-ink">{nameOf(s)}</p>
                    {actor.locale === 'ar' && s.displayNameEn && <p className="ltr-data text-xs text-muted">{s.displayNameEn}</p>}
                  </div>
                  <Badge tone="brand">{t(`roles.${s.role}`)}</Badge>
                  <Badge tone={statusTone[s.status]}>{t(`employeeStatus.${s.status}`)}</Badge>
                  {s.account ? (
                    <Badge tone={accountTone[s.account.status]}>{t(`accountStatus.${s.account.status}`)}</Badge>
                  ) : (
                    <Badge>{t('staff.noAccountShort')}</Badge>
                  )}
                  {'currentSalaryHalalas' in s && (
                    <span className="min-w-28 text-end text-sm font-medium text-ink">
                      {s.currentSalaryHalalas == null ? <span className="text-muted">{t('common.notSet')}</span> : formatMoney(s.currentSalaryHalalas, actor.locale)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
