import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { linkStatusTone } from '@/components/status-tones'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { CopyButton } from '@/components/copy-button'
import { toSarString } from '@/domain/money'
import { createTranslator } from '@/i18n'
import { formatDateTime, formatMoney } from '@/i18n/format'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { NotFoundError } from '@/server/services/errors'
import { linkDefaultsForOrder, listPaymentLinks, providerStates, type LinkListFilter } from '@/server/services/payment-links'
import { CancelLinkButton, NewLinkForm, SettlementForms, WhatsappLinkButton, type LinkDefaults } from './link-forms'

const TABS = ['new', 'all', 'open', 'paid', 'unlinked', 'settlement'] as const

export default async function PaymentLinksPage({ searchParams }: { searchParams: Promise<{ tab?: string; order?: string }> }) {
  const { actor, allowed } = await pagePermission('payments.links')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const sp = await searchParams
  const tab = TABS.find((x) => x === sp.tab) ?? 'new'
  let defaults: LinkDefaults | null = null
  if (sp.order) {
    try {
      const d = await linkDefaultsForOrder(actor, sp.order)
      if (d.status !== 'cancelled' && d.status !== 'draft') defaults = { orderId: d.orderId, reference: d.reference, customerName: d.customerName, phone: d.phone, suggestedSar: d.suggestedHalalas > 0 ? toSarString(d.suggestedHalalas) : '' }
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }
  const rows = tab === 'new' ? [] : await listPaymentLinks(actor, tab as LinkListFilter)
  const manage = can(actor, 'payments.approve_transfer')
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('paymentLinks.title')} subtitle={t('paymentLinks.subtitle')} />
      <nav aria-label={t('paymentLinks.title')} className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <Link
            key={x}
            href={`/payments/links?tab=${x}${sp.order && x === 'new' ? `&order=${sp.order}` : ''}`}
            aria-current={x === tab ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold ${x === tab ? 'border-brand-deep bg-brand-deep text-white' : 'border-line bg-surface text-brand-deep'}`}
          >
            {t(`paymentLinks.tabs.${x}`)}
          </Link>
        ))}
      </nav>
      {tab === 'new' ? (
        <Card>
          <NewLinkForm providers={providerStates()} defaults={defaults} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState body={t('paymentLinks.empty')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ l, orderReference }) => (
            <li key={l.id}>
              <Card>
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold text-ink">{formatMoney(l.amountHalalas, actor.locale)}</span>
                    <Badge tone={linkStatusTone[l.status]}>{t(`paymentLinks.statuses.${l.status}`)}</Badge>
                    {l.needsSettlement && <Badge tone="warning">{t('paymentLinks.needsSettlement')}</Badge>}
                    <span className="text-muted">{t(`paymentLinks.providers.${l.provider}`)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
                    {l.customerName && <span dir="auto" className="text-ink">{l.customerName}</span>}
                    <span className="ltr-data">{l.customerPhoneE164}</span>
                    {orderReference && (
                      <Link href={`/orders/${l.orderId}`} className="ltr-data text-brand-deep underline">
                        {orderReference}
                      </Link>
                    )}
                    <bdi>{formatDateTime(l.createdAt, actor.locale)}</bdi>
                    <span>
                      {t('paymentLinks.reference')}: <span className="ltr-data">{l.reference}</span>
                    </span>
                  </div>
                  {l.needsSettlement && l.settlementNote && <p className="text-warning">{t(`paymentLinks.settlementReasons.${l.settlementNote as 'unlinked'}`)}</p>}
                  {(l.status === 'open' || l.status === 'creating') && (
                    <div className="flex flex-wrap gap-2">
                      {l.checkoutUrl && <WhatsappLinkButton linkId={l.id} />}
                      {l.checkoutUrl && <CopyButton value={l.checkoutUrl} label={t('paymentLinks.copy')} />}
                      <CancelLinkButton linkId={l.id} />
                    </div>
                  )}
                  {manage && l.needsSettlement && l.status === 'paid' && !l.paymentId && <SettlementForms linkId={l.id} />}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
