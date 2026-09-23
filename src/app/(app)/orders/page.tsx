import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { inputClass } from '@/components/form-styles'
import { Badge, ButtonLink, buttonStyles, Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { describeAppointment, formatMoney } from '@/i18n/format'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { listOrders } from '@/server/services/orders'

import { orderStatusTone as statusTone } from '@/components/status-tones'
const STATUSES = ['draft', 'confirmed', 'completed', 'pending_review'] as const

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string }> }) {
  const { actor, allowed } = await pagePermission('orders.read.all')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const f = await searchParams
  const rows = await listOrders(actor, { q: f.q?.slice(0, 100), status: f.status, from: f.from, to: f.to })
  return (
    <div>
      <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} actions={can(actor, 'orders.manage') ? <ButtonLink href="/orders/new">{t('orders.new')}</ButtonLink> : undefined} />
      <Card>
        <form className="mb-4 grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-5" role="search">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink lg:col-span-2">
            {t('orders.searchLabel')}
            <input name="q" defaultValue={f.q} className={inputClass} dir="auto" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t('orders.filterStatus')}
            <select name="status" defaultValue={f.status ?? ''} className={inputClass}>
              <option value="">{t('orders.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`orderStatus.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t('orders.from')}
            <input type="date" name="from" defaultValue={f.from} className={inputClass} dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t('orders.to')}
            <input type="date" name="to" defaultValue={f.to} className={inputClass} dir="ltr" />
          </label>
          <button type="submit" className={`${buttonStyles.secondary} lg:col-start-5`}>
            {t('orders.apply')}
          </button>
        </form>
        {rows.length === 0 ? (
          <EmptyState body={t('orders.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((o) => {
              const appt = o.firstStart ? describeAppointment(o.firstStart, actor.locale) : null
              return (
                <li key={o.id}>
                  <Link href={o.status === 'draft' && can(actor, 'orders.manage') ? `/orders/${o.id}/edit` : `/orders/${o.id}`} className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg px-2 py-3 text-sm hover:bg-cream sm:grid-cols-[8rem_1fr_auto_12rem_7rem]">
                    <span className="ltr-data font-semibold text-ink">{o.reference}</span>
                    <span className="text-ink" dir="auto">
                      {o.customerName}
                    </span>
                    <span>
                      <Badge tone={statusTone[o.status]}>{t(`orderStatus.${o.status}`)}</Badge>
                    </span>
                    <span className="text-muted">
                      {appt ? (
                        <>
                          {appt.date} · <bdi>{appt.time}</bdi>
                        </>
                      ) : (
                        t('orders.notScheduled')
                      )}
                    </span>
                    <span className="font-semibold text-ink sm:text-end">{formatMoney(o.grandTotalHalalas, actor.locale)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
