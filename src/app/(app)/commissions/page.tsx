import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatDateTime, formatMoney } from '@/i18n/format'
import { can } from '@/server/authz/actor'
import { requireActor } from '@/server/auth/current'
import { allCommissions, myCommissions } from '@/server/services/commissions'
import { AdjustCommissionForm } from './adjust-form'

export default async function CommissionsPage() {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  const money = (v: number) => formatMoney(v, actor.locale)
  if (can(actor, 'commissions.read.all')) {
    const all = await allCommissions(actor)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('commissions.all')} />
        <Card>
          <ul className="divide-y divide-line">
            {all.map((e) => (
              <li key={e.id} className="grid grid-cols-2 gap-2 py-2 text-sm sm:grid-cols-4">
                <span className="font-semibold text-ink">
                  {e.name} <span className="text-xs font-normal text-muted">· {t(`roles.${e.role}`)}</span>
                </span>
                <span>
                  {t('commissions.expected')}: {money(e.expected)}
                </span>
                <span>
                  {t('commissions.earned')}: <strong>{money(e.earnedUnpaid)}</strong>
                </span>
                <span>
                  {t('commissions.paid')}: {money(e.paid)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        {can(actor, 'commissions.adjust') && (
          <Card title={t('commissions.adjust')}>
            <AdjustCommissionForm employees={all.map((e) => ({ id: e.id, name: e.name }))} />
          </Card>
        )}
      </div>
    )
  }
  if (!can(actor, 'commissions.read.own')) return <Forbidden message={t('errors.forbidden')} />
  const { summary, entries } = await myCommissions(actor)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('commissions.mine')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('commissions.expected')} value={money(summary.expected)} hint={t('commissions.expectedHint')} />
        <Stat label={t('commissions.earned')} value={money(summary.earnedUnpaid)} />
        <Stat label={t('commissions.paid')} value={money(summary.paid)} />
      </div>
      <Card title={t('commissions.entries')}>
        {entries.length === 0 ? (
          <EmptyState body={t('commissions.none')} />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="text-muted">{formatDateTime(e.earnedAt, actor.locale)}</span>
                <span>{t(`commissions.kinds.${e.kind}`)}</span>
                {e.reference && can(actor, 'orders.read.all') ? (
                  <Link href={`/orders/${e.orderId}`} className="ltr-data text-brand-deep underline">
                    {e.reference}
                  </Link>
                ) : (
                  <span className="ltr-data text-muted">{e.reference ?? ''}</span>
                )}
                <span className="font-semibold">
                  <bdi>{money(e.amount)}</bdi> {e.settled && <span className="text-xs text-success">· {t('commissions.paid')}</span>}
                </span>
                {e.reason && (
                  <span className="w-full text-xs text-muted" dir="auto">
                    {e.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
