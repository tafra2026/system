import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { MonthPicker } from '@/components/month-picker'
import { Card, PageHeader } from '@/components/ui'
import { currentMonth, isMonthKey } from '@/domain/months'
import { createTranslator } from '@/i18n'
import { formatMoney } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { monthlyReport, type Metric } from '@/server/services/reports'
import { listTeams } from '@/server/services/teams'
import { can } from '@/server/authz/actor'

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { actor, allowed } = await pagePermission('sales.read')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const q = (await searchParams).month
  const month = q && isMonthKey(q) ? q : currentMonth()
  const r = await monthlyReport(actor, month)
  const money = (v: number) => formatMoney(v, actor.locale)
  const name = (x: { nameAr: string; nameEn: string }) => (actor.locale === 'en' ? x.nameEn : x.nameAr)

  const Figure = ({ label, value, metric, hint, tone }: { label: string; value: number; metric?: Metric; hint?: string; tone?: 'good' | 'bad' }) => (
    <div className="rounded-xl bg-brand-soft/60 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-xl font-bold ${tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-success' : 'text-ink'}`}>
        <bdi>{money(value)}</bdi>
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {metric && (
        <Link href={`/reports/${metric}?month=${month}`} className="text-xs font-medium text-brand-deep underline">
          {t('reports.details')}
        </Link>
      )}
    </div>
  )

  const teams = r.finance && can(actor, 'schedule.manage') ? await listTeams(actor) : []

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('reports.title')} />
      <MonthPicker path="/reports" month={month} labels={{ previous: t('calendar.previous'), next: t('calendar.next'), apply: t('orders.apply'), month: t('reports.month') }} />

      <Card title={t('reports.salesTitle')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Figure label={t('reports.bookedValue')} value={r.sales.bookedValue} metric="booked" />
          <div className="rounded-xl bg-brand-soft/60 p-3">
            <p className="text-xs text-muted">{t('reports.bookings')}</p>
            <p className="text-xl font-bold text-ink">{r.sales.bookings}</p>
            <p className="text-xs text-muted">
              {t('reports.newCustomers')}: {r.sales.newCustomers} · {t('reports.returningCustomers')}: {r.sales.returningCustomers}
            </p>
          </div>
          <Figure label={t('reports.averageOrder')} value={r.sales.averageOrder} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t('reports.topItems')}</h3>
            <ol className="flex flex-col gap-1 text-sm">
              {r.sales.topItems.map((i) => (
                <li key={i.kind + i.nameAr} className="flex justify-between gap-2">
                  <span dir="auto">{name(i)}</span>
                  <span className="text-muted">
                    ×{i.count} · {money(i.value)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t('reports.byModerator')}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {r.sales.byModerator.map((m) => (
                <li key={m.name} className="flex justify-between gap-2">
                  <span>{m.name}</span>
                  <span className="text-muted">
                    {m.orders} {t('reports.orders')} · {money(m.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-3">
          <a href={`/api/reports/export?metric=booked&month=${month}`} className="text-sm font-medium text-brand-deep underline">
            {t('reports.export')}
          </a>
        </div>
      </Card>

      {r.finance && (
        <>
          <Card title={t('reports.financeTitle')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Figure label={t('reports.executedRevenue')} value={r.executedRevenue} metric="executed" />
              <Figure label={t('reports.collections')} value={r.collections.total} metric="collections" hint={`${t('reports.deposits')}: ${money(r.collections.deposits)}`} />
              <Figure label={t('reports.deferred')} value={r.deferred} metric="deferred" />
              <Figure label={t('reports.outstanding')} value={r.outstanding} metric="outstanding" />
              <Figure label={t('reports.operatingResult')} value={r.operatingResult} tone={r.operatingResult >= 0 ? 'good' : 'bad'} />
              <Figure label={t('reports.cashFlow')} value={r.cashFlow.net} hint={`${t('reports.cashIn')} ${money(r.cashFlow.in)} · ${t('reports.cashOut')} ${money(r.cashFlow.out)}`} tone={r.cashFlow.net >= 0 ? 'good' : 'bad'} />
            </div>
            <p className="mt-3 text-xs text-muted">{t('reports.gateways')}</p>
            <div className="mt-3">
              <h3 className="mb-1 text-sm font-semibold text-ink">{t('reports.byMethod')}</h3>
              <ul className="flex flex-wrap gap-3 text-sm">
                {Object.entries(r.collections.byMethod).map(([m, v]) => (
                  <li key={m}>
                    {t(`payments.methods.${m as 'cash'}`)}: <strong>{money(v)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title={t('reports.expensesTitle')}>
            <ul className="divide-y divide-line text-sm">
              {r.expenses.byCategory.map((c) => (
                <li key={c.code} className="flex justify-between py-1.5">
                  <span>{name(c)}</span>
                  <span>{money(c.amount)}</span>
                </li>
              ))}
              <li className="flex justify-between py-1.5">
                <span>
                  {t('reports.salaries')}
                  {r.expenses.salariesEstimated && <span className="ms-2 text-xs text-warning">({t('reports.salariesEstimated')})</span>}
                </span>
                <span>{money(r.expenses.salaries)}</span>
              </li>
              <li className="flex justify-between py-1.5">
                <Link href={`/reports/commissions?month=${month}`} className="text-brand-deep underline">
                  {t('reports.commissions')}
                </Link>
                <span>{money(r.expenses.commissions)}</span>
              </li>
              <li className="flex justify-between py-1.5">
                <span>{t('reports.bonuses')}</span>
                <span>{money(r.expenses.bonuses)}</span>
              </li>
              <li className="flex justify-between py-1.5">
                <span>{t('reports.deductions')}</span>
                <span>
                  <bdi>{r.expenses.deductions > 0 ? `−${money(r.expenses.deductions)}` : money(0)}</bdi>
                </span>
              </li>
              <li className="flex justify-between py-1.5 font-bold">
                <Link href={`/reports/expenses?month=${month}`} className="text-brand-deep underline">
                  {t('reports.totalExpenses')}
                </Link>
                <span>{money(r.expenses.total)}</span>
              </li>
            </ul>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title={t('reports.bySpecialist')}>
              <ul className="flex flex-col gap-1 text-sm">
                {r.bySpecialist.map((s) => (
                  <li key={s.name} className="flex justify-between gap-2">
                    <span>{s.name}</span>
                    <span className="text-muted">
                      {s.visits} {t('reports.visits')} · {money(s.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t('reports.byTeam')}>
              <ul className="flex flex-col gap-1 text-sm">
                {r.byTeam.map((s) => (
                  <li key={s.teamId} className="flex justify-between gap-2">
                    <span>{teams.find((x) => x.id === s.teamId)?.name ?? t('reports.noTeam')}</span>
                    <span className="text-muted">
                      {s.visits} {t('reports.visits')} · {money(s.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
