import { createTranslator } from '@/i18n'
import { formatDateTime, formatMoney } from '@/i18n/format'
import type { Actor } from '@/server/authz/actor'
import { listPaymentLinks } from '@/server/services/payment-links'
import { linkStatusTone } from './status-tones'
import { Badge, Card } from './ui'

/** Payment links created for one order (status is the provider's verified state). */
export async function OrderPaymentLinksCard({ actor, orderId }: { actor: Actor; orderId: string }) {
  const rows = await listPaymentLinks(actor, 'all', orderId)
  if (rows.length === 0) return null
  const t = createTranslator(actor.locale)
  return (
    <Card title={t('paymentLinks.title')} subtitle={t('paymentLinks.authorizedNote')}>
      <ul className="divide-y divide-line text-sm">
        {rows.map(({ l }) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-semibold">{formatMoney(l.amountHalalas, actor.locale)}</span>
            <Badge tone={linkStatusTone[l.status]}>{t(`paymentLinks.statuses.${l.status}`)}</Badge>
            {l.needsSettlement && <Badge tone="warning">{t('paymentLinks.needsSettlement')}</Badge>}
            <span className="text-xs text-muted">{t(`paymentLinks.providers.${l.provider}`)}</span>
            <bdi className="text-xs text-muted">{formatDateTime(l.createdAt, actor.locale)}</bdi>
            <span className="ltr-data text-xs text-muted">{l.reference}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
