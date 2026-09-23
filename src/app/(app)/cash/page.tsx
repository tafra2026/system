import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { DecideTransferButtons } from '@/components/payment-forms'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { toSarString } from '@/domain/money'
import { createTranslator } from '@/i18n'
import { formatDateTime, formatMoney } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { custodySummary, pendingTransfers, recentHandovers } from '@/server/services/payments'
import { HandoverForm } from './cash-forms'

export default async function CashPage() {
  const { actor, allowed } = await pagePermission('cash.receive_handover')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const [custody, transfers, handovers] = await Promise.all([custodySummary(actor), pendingTransfers(actor), recentHandovers(actor, 30)])
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('cash.title')} subtitle={t('cash.subtitle')} />
      {custody.length === 0 ? (
        <Card>
          <EmptyState body={t('cash.none')} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {custody.map((c) => (
            <Card key={c.employeeId} title={c.name} subtitle={`${t('cash.expected')}: ${formatMoney(c.totalHalalas, actor.locale)}`}>
              <ul className="mb-3 flex flex-col gap-1 text-sm">
                {c.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <Link href={`/orders/${p.orderId}`} className="ltr-data text-brand-deep underline">
                      {p.reference}
                    </Link>
                    <span className="text-muted">{formatDateTime(p.receivedAt, actor.locale)}</span>
                    <span className="font-semibold">{formatMoney(p.amount, actor.locale)}</span>
                  </li>
                ))}
              </ul>
              <HandoverForm employeeId={c.employeeId} expectedSar={toSarString(c.totalHalalas)} />
            </Card>
          ))}
        </div>
      )}
      <Card title={t('payments.pendingTitle')}>
        {transfers.length === 0 ? (
          <p className="text-sm text-muted">{t('payments.noPending')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {transfers.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <Link href={`/orders/${p.orderId}`} className="ltr-data font-semibold text-brand-deep underline">
                    {p.reference}
                  </Link>
                  <span dir="auto">{p.customerName}</span>
                  <span className="font-semibold">{formatMoney(p.amountHalalas, actor.locale)}</span>
                </div>
                <span className="text-xs text-muted">
                  {formatDateTime(p.receivedAt, actor.locale)} {p.paymentReference && <span className="ltr-data">· {p.paymentReference}</span>}
                </span>
                <DecideTransferButtons paymentId={p.id} path="/cash" />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('cash.recent')}>
        {handovers.length === 0 ? (
          <p className="text-sm text-muted">{t('cash.noRecent')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {handovers.map(({ h, fullName, displayNameEn }) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{actor.locale === 'en' && displayNameEn ? displayNameEn : fullName}</span>
                <span className="text-muted">{formatDateTime(h.handedAt, actor.locale)}</span>
                <span>
                  {t('cash.expected')} {formatMoney(h.expectedHalalas, actor.locale)} · {formatMoney(h.actualHalalas, actor.locale)}
                  {h.actualHalalas !== h.expectedHalalas && (
                    <span className="text-danger">
                      {' '}
                      ({t('cash.difference')} <bdi>{formatMoney(h.actualHalalas - h.expectedHalalas, actor.locale)}</bdi>)
                    </span>
                  )}
                </span>
                {h.differenceReason && (
                  <span className="w-full text-xs text-muted" dir="auto">
                    {h.differenceReason}
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
