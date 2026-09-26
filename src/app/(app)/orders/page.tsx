import Link from 'next/link'
import { RememberListUrl } from '@/components/back-link'
import { Forbidden } from '@/components/forbidden'
import { inputClass } from '@/components/form-styles'
import { orderStatusTone as statusTone } from '@/components/status-tones'
import { Badge, ButtonLink, buttonStyles, Card, EmptyState, PageHeader } from '@/components/ui'
import { mapsLink } from '@/domain/order'
import { createTranslator } from '@/i18n'
import { describeAppointment, formatMoney } from '@/i18n/format'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { listOrders, ORDER_SORTS, staffForOrderFilters } from '@/server/services/orders'

const STATUSES = ['draft', 'confirmed', 'completed', 'pending_review', 'cancelled'] as const
const METHODS = ['cash', 'bank_transfer', 'pos', 'tabby', 'tamara', 'paymob'] as const
const PERIODS = ['all', 'today', 'upcoming', 'range'] as const
const PAYMENT = ['unpaid', 'partial', 'paid'] as const

type SP = { q?: string; status?: string; period?: string; from?: string; to?: string; driver?: string; specialist?: string; method?: string; payment?: string; awaiting?: string; sort?: string; page?: string }

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { actor, allowed } = await pagePermission('orders.read.all')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const f = await searchParams
  const [list, staff] = await Promise.all([
    listOrders(actor, {
      q: f.q,
      status: f.status,
      period: f.period,
      from: f.from,
      to: f.to,
      driverId: f.driver,
      specialistId: f.specialist,
      method: f.method,
      payment: f.payment,
      awaitingDriver: f.awaiting === '1',
      sort: f.sort,
      page: Number(f.page) || 1,
    }),
    staffForOrderFilters(actor),
  ])
  const money = (h: number) => formatMoney(h, actor.locale)
  const pageHref = (p: number) => {
    const sp = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== 'page') as [string, string][])
    sp.set('page', String(p))
    return `/orders?${sp.toString()}`
  }
  const link = (o: (typeof list.rows)[number]) => (o.status === 'draft' && can(actor, 'orders.manage') ? `/orders/${o.id}/edit` : `/orders/${o.id}`)
  const when = (d: Date | null) => {
    if (!d) return t('orders.notScheduled')
    const a = describeAppointment(d, actor.locale)
    return (
      <>
        {a.date} · <bdi>{a.time}</bdi>
      </>
    )
  }
  const paymentBadge = (o: (typeof list.rows)[number]) => {
    const remaining = Math.max(0, o.grandTotalHalalas - o.paidHalalas)
    const state = remaining === 0 ? 'paid' : o.paidHalalas > 0 ? 'partial' : 'unpaid'
    return <Badge tone={state === 'paid' ? 'success' : state === 'partial' ? 'warning' : 'neutral'}>{t(`orders.payment.${state}`)}</Badge>
  }
  const advanced = [f.from, f.to, f.driver, f.specialist, f.method, f.payment, f.sort, f.awaiting].filter(Boolean).length
  const methods = (o: (typeof list.rows)[number]) =>
    o.methods ? o.methods.split(',').map((m) => t(`payments.methods.${m as 'cash'}`)).join(t('common.listSeparator')) : '—'

  return (
    <div className="flex flex-col gap-4">
      <RememberListUrl href="/orders" />
      <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} actions={can(actor, 'orders.manage') ? <ButtonLink href="/orders/new">{t('orders.new')}</ButtonLink> : undefined} />
      <Card>
        <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink sm:col-span-2">
            {t('orders.searchLabel')}
            <input name="q" defaultValue={f.q} className={inputClass} dir="auto" placeholder={t('orders.searchPlaceholder')} />
          </label>
          <Select name="period" label={t('orders.period')} value={f.period ?? list.period ?? 'all'} options={PERIODS.map((p) => [p, t(`orders.periods.${p}`)])} />
          <Select name="status" label={t('orders.filterStatus')} value={f.status ?? ''} options={[['', t('orders.all')], ...STATUSES.map((s) => [s, t(`orderStatus.${s}`)] as [string, string])]} />
          {/* Less-used filters fold away so the list is visible on a phone; open when one is in use. */}
          <details open={advanced > 0} className="group sm:col-span-2 lg:col-span-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-brand-deep">
              <span aria-hidden className="transition-transform group-open:rotate-90 rtl:-scale-x-100">▸</span>
              {t('orders.moreFilters')}
              {advanced > 0 && <Badge tone="brand">{advanced}</Badge>}
            </summary>
            <div className="mt-2 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                {t('orders.from')}
                <input type="date" name="from" defaultValue={f.from} className={inputClass} dir="ltr" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                {t('orders.to')}
                <input type="date" name="to" defaultValue={f.to} className={inputClass} dir="ltr" />
              </label>
              <Select name="driver" label={t('orders.driver')} value={f.driver ?? ''} options={[['', t('orders.all')], ...staff.drivers.map((d) => [d.id, d.name] as [string, string])]} />
              <Select name="specialist" label={t('orders.specialists')} value={f.specialist ?? ''} options={[['', t('orders.all')], ...staff.specialists.map((d) => [d.id, d.name] as [string, string])]} />
              <Select name="method" label={t('orders.paymentMethod')} value={f.method ?? ''} options={[['', t('orders.all')], ...METHODS.map((m) => [m, t(`payments.methods.${m}`)] as [string, string])]} />
              <Select name="payment" label={t('orders.paymentState')} value={f.payment ?? ''} options={[['', t('orders.all')], ...PAYMENT.map((m) => [m, t(`orders.payment.${m}`)] as [string, string])]} />
              <Select name="sort" label={t('orders.sort')} value={f.sort ?? list.sort ?? ''} options={ORDER_SORTS.map((s) => [s, t(`orders.sorts.${s}`)])} />
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="awaiting" value="1" defaultChecked={f.awaiting === '1'} className="h-5 w-5 accent-[var(--color-brand-deep)]" />
                {t('orders.awaitingDriver')}
              </label>
            </div>
          </details>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={buttonStyles.primary}>
              {t('orders.apply')}
            </button>
            <Link href="/orders" className={buttonStyles.ghost}>
              {t('orders.reset')}
            </Link>
            <span className="ms-auto self-center text-sm text-muted">{t('orders.count', { count: list.total })}</span>
          </div>
        </form>
      </Card>

      {list.rows.length === 0 ? (
        <Card>
          <EmptyState body={t('orders.empty')} />
        </Card>
      ) : (
        <>
          {/* Desktop: table. Only the table scrolls sideways inside its card, never the page. */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-start text-xs text-muted">
                    <th className="p-2 text-start font-medium">{t('orders.reference')}</th>
                    <th className="p-2 text-start font-medium">{t('orders.customer')}</th>
                    <th className="p-2 text-start font-medium">{t('orders.visitTime')}</th>
                    <th className="p-2 text-start font-medium">{t('orders.specialists')}</th>
                    <th className="p-2 text-start font-medium">{t('orders.driver')}</th>
                    <th className="p-2 text-end font-medium">{t('orders.total')}</th>
                    <th className="p-2 text-end font-medium">{t('orders.paidRemaining')}</th>
                    <th className="p-2 text-start font-medium">{t('orders.statusCol')}</th>
                    <th className="p-2 text-start font-medium">{t('orders.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((o) => (
                    <tr key={o.id} className="border-b border-line align-top hover:bg-cream/60">
                      <td className="p-2">
                        <Link href={link(o)} className="ltr-data font-semibold text-brand-deep underline">
                          {o.reference}
                        </Link>
                        {o.visitCount > 1 && <span className="block text-xs text-muted">{t('orders.visitsCount', { count: o.visitCount })}</span>}
                      </td>
                      <td className="max-w-48 p-2">
                        <span className="block break-words text-ink" dir="auto">
                          {o.customerName}
                        </span>
                        {o.district && (
                          <span className="block text-xs text-muted" dir="auto">
                            {o.district}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-muted">{when(o.firstStart)}</td>
                      <td className="max-w-40 p-2 break-words text-ink">{o.specialists ?? '—'}</td>
                      <td className="p-2">{o.awaitingDriver ? <Badge tone="warning">{t('orders.awaitingDriverBadge')}</Badge> : <span className="text-ink">{o.drivers ?? '—'}</span>}</td>
                      <td className="p-2 text-end font-semibold text-ink">{money(o.grandTotalHalalas)}</td>
                      <td className="p-2 text-end">
                        <span className="block text-ink">{money(o.paidHalalas)}</span>
                        <span className="block text-xs text-muted">{money(Math.max(0, o.grandTotalHalalas - o.paidHalalas))}</span>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={statusTone[o.status]}>{t(`orderStatus.${o.status}`)}</Badge>
                          {paymentBadge(o)}
                          <span className="text-xs text-muted">{methods(o)}</span>
                        </div>
                      </td>
                      <td className="p-2">
                        <RowActions o={o} t={t} link={link(o)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile: cards with the essentials first. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {list.rows.map((o) => (
              <li key={o.id}>
                <Card>
                  <div className="flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={link(o)} className="ltr-data font-semibold text-brand-deep underline">
                        {o.reference}
                      </Link>
                      <Badge tone={statusTone[o.status]}>{t(`orderStatus.${o.status}`)}</Badge>
                    </div>
                    <p className="break-words font-semibold text-ink" dir="auto">
                      {o.customerName}
                      {o.district && <span className="font-normal text-muted"> · {o.district}</span>}
                    </p>
                    <p className="text-muted">{when(o.firstStart)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{money(o.grandTotalHalalas)}</span>
                      {paymentBadge(o)}
                      {o.awaitingDriver && <Badge tone="warning">{t('orders.awaitingDriverBadge')}</Badge>}
                    </div>
                    <details className="text-muted">
                      <summary className="min-h-11 cursor-pointer content-center text-brand-deep">{t('orders.more')}</summary>
                      <dl className="mt-1 grid grid-cols-1 gap-1">
                        <div>
                          {t('orders.specialists')}: <span className="text-ink">{o.specialists ?? '—'}</span>
                        </div>
                        <div>
                          {t('orders.driver')}: <span className="text-ink">{o.drivers ?? '—'}</span>
                        </div>
                        <div>
                          {t('orders.paidRemaining')}: <span className="text-ink">{money(o.paidHalalas)} / {money(Math.max(0, o.grandTotalHalalas - o.paidHalalas))}</span>
                        </div>
                        <div>
                          {t('orders.paymentMethod')}: <span className="text-ink">{methods(o)}</span>
                        </div>
                      </dl>
                    </details>
                    <RowActions o={o} t={t} link={link(o)} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {list.pages > 1 && (
            <nav aria-label={t('orders.pagination')} className="flex flex-wrap items-center justify-center gap-2">
              {list.page > 1 && (
                <Link href={pageHref(list.page - 1)} className={buttonStyles.secondary}>
                  {t('orders.prev')}
                </Link>
              )}
              <span className="text-sm text-muted">{t('orders.pageOf', { page: list.page, pages: list.pages })}</span>
              {list.page < list.pages && (
                <Link href={pageHref(list.page + 1)} className={buttonStyles.secondary}>
                  {t('orders.next')}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: readonly (readonly [string, string])[] }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-ink">
      {label}
      <select name={name} defaultValue={value} className={inputClass}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

type Row = Awaited<ReturnType<typeof listOrders>>['rows'][number]
function RowActions({ o, t, link }: { o: Row; t: ReturnType<typeof createTranslator>; link: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      <Link href={link} className="font-medium text-brand-deep underline">
        {t('orders.open')}
      </Link>
      {o.latitude != null && o.longitude != null && (
        <a href={mapsLink(o.latitude, o.longitude)} target="_blank" rel="noreferrer" className="font-medium text-brand-deep underline">
          {t('orders.map')}
        </a>
      )}
      {o.hasPhoto && <span className="text-muted">📷 {t('orders.hasPhoto')}</span>}
      {o.status !== 'draft' && o.status !== 'cancelled' && Math.max(0, o.grandTotalHalalas - o.paidHalalas) > 0 && (
        <Link href={`/payments/links?order=${o.id}`} className="font-medium text-brand-deep underline">
          {t('paymentLinks.fromOrder')}
        </Link>
      )}
    </div>
  )
}
