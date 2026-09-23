import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Forbidden } from '@/components/forbidden'
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatDateTime, formatMoney } from '@/i18n/format'
import { mapsLink } from '@/domain/order'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { NotFoundError } from '@/server/services/errors'
import { getCustomer } from '@/server/services/customers'
import { AddAddressForm, EditAddressForm, EditCustomerForm, VipForm } from '../customer-forms'

import { orderStatusTone as statusTone } from '@/components/status-tones'

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { actor, allowed } = await pagePermission('customers.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  let data: Awaited<ReturnType<typeof getCustomer>>
  try {
    data = await getCustomer(actor, id)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }
  const { customer, addresses, orders } = data
  return (
    <div className="flex flex-col gap-4">
      <Link href="/customers" className="text-sm font-medium text-brand-deep hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader
        title={customer.name}
        subtitle={customer.phoneE164}
        actions={
          <div className="flex items-center gap-2">
            {customer.isVip && <Badge tone="brand">{t('customers.vip')}</Badge>}
            {can(actor, 'orders.manage') && <ButtonLink href={`/orders/new?customer=${customer.id}`}>{t('customers.newBooking')}</ButtonLink>}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('customers.profile')}>
          <EditCustomerForm id={customer.id} defaults={{ name: customer.name, phone: customer.phoneE164, altPhone: customer.altPhoneE164, messageLocale: customer.messageLocale, notes: customer.notes }} />
        </Card>
        <div className="flex flex-col gap-4">
          {can(actor, 'vip.manage') && (
            <Card title={t('customers.vip')}>
              <VipForm id={customer.id} isVip={customer.isVip} />
            </Card>
          )}
          <Card title={t('customers.history')}>
            {orders.length === 0 ? (
              <EmptyState body={t('customers.noOrders')} />
            ) : (
              <ul className="divide-y divide-line">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:bg-cream">
                      <span className="ltr-data font-semibold text-ink">{o.reference}</span>
                      <Badge tone={statusTone[o.status]}>{t(`orderStatus.${o.status}`)}</Badge>
                      <span className="text-muted">{formatDateTime(o.createdAt, actor.locale)}</span>
                      <span className="font-medium text-ink">{formatMoney(o.grandTotalHalalas, actor.locale)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <Card title={t('customers.addresses')}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {addresses.length === 0 && <p className="text-sm text-muted">{t('customers.noAddresses')}</p>}
          {addresses.map((a) => (
            <details key={a.id} className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                {a.label ? `${a.label} — ` : ''}
                {a.district}
                {a.latitude != null && a.longitude != null ? (
                  <a href={mapsLink(a.latitude, a.longitude)} target="_blank" rel="noreferrer" className="ms-2 text-xs font-medium text-brand-deep underline">
                    {t('customers.openMap')}
                  </a>
                ) : (
                  <span className="ms-2 text-xs font-normal text-muted">{t('customers.noLocation')}</span>
                )}
              </summary>
              <div className="mt-3">
                <EditAddressForm
                  customerId={customer.id}
                  addressId={a.id}
                  defaults={{ label: a.label, district: a.district, addressLine: a.addressLine, buildingDetails: a.buildingDetails, accessInstructions: a.accessInstructions, location: a.latitude != null ? `${a.latitude}, ${a.longitude}` : '' }}
                />
              </div>
            </details>
          ))}
          <div className="rounded-xl border border-dashed border-line p-3">
            <h3 className="mb-3 text-sm font-semibold text-ink">{t('customers.addAddress')}</h3>
            <AddAddressForm customerId={customer.id} />
          </div>
        </div>
      </Card>
    </div>
  )
}
