import { toSarString } from '@/domain/money'
import { createTranslator } from '@/i18n'
import { formatDateTime, formatMoney } from '@/i18n/format'
import type { Actor } from '@/server/authz/actor'
import { can } from '@/server/authz/actor'
import { orderPayments } from '@/server/services/payments'
import { DecideTransferButtons, RecordPaymentForm, type PayMethod } from './payment-forms'
import { Badge, Card } from './ui'

const tone = { pending: 'warning', confirmed: 'success', rejected: 'danger' } as const

export function allowedMethods(actor: Actor): PayMethod[] {
  return [
    ...(can(actor, 'payments.record_cash_pos') ? (['cash', 'pos'] as const) : []),
    ...(can(actor, 'orders.manage') ? (['bank_transfer'] as const) : []),
    ...(can(actor, 'payments.approve_transfer') ? (['tabby', 'tamara'] as const) : []),
  ]
}

/** Payments of an order with balance, recording and transfer approval. */
export async function PaymentsCard({ actor, orderId, path, closed }: { actor: Actor; orderId: string; path: string; closed?: boolean }) {
  const t = createTranslator(actor.locale)
  const { payments, balance } = await orderPayments(actor, orderId)
  const remaining = balance.total - balance.confirmed - balance.pending
  return (
    <Card title={t('payments.title')} subtitle={balance.remaining <= 0 ? t('payments.fullyPaid') : `${t('payments.remainingToCollect')}: ${formatMoney(balance.remaining, actor.locale)}`}>
      {payments.length === 0 ? (
        <p className="mb-3 text-sm text-muted">{t('payments.none')}</p>
      ) : (
        <ul className="mb-3 divide-y divide-line">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink">
                  {formatMoney(p.amountHalalas, actor.locale)} · {t(`payments.methods.${p.method}`)}
                  {p.isDeposit && <span className="ms-2 text-xs font-normal text-muted">({t('payments.deposit')})</span>}
                </span>
                <Badge tone={tone[p.status]}>{t(`payments.statuses.${p.status}`)}</Badge>
              </div>
              <span className="text-xs text-muted">
                {formatDateTime(p.receivedAt, actor.locale)}
                {p.reference && (
                  <>
                    {' · '}
                    <span className="ltr-data">{p.reference}</span>
                  </>
                )}
                {p.holderName && ` · ${t('payments.holder')}: ${p.holderName}`}
                {p.rejectReason && ` · ${p.rejectReason}`}
              </span>
              {p.status === 'pending' && can(actor, 'payments.approve_transfer') && <DecideTransferButtons paymentId={p.id} path={path} />}
            </li>
          ))}
        </ul>
      )}
      {!closed && remaining > 0 && <RecordPaymentForm orderId={orderId} path={path} methods={allowedMethods(actor)} remainingSar={toSarString(remaining)} compact />}
    </Card>
  )
}
