import { ButtonLink, Card, EmptyState, Stat } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatCalendarDate, formatDate, formatMoney, formatTime } from '@/i18n/format'
import { operationalDateOf } from '@/domain/operational-day'
import { can } from '@/server/authz/actor'
import { requireActor } from '@/server/auth/current'
import { staffSummary } from '@/server/services/staff'
import { mySchedule, visitsOnOperationalDate } from '@/server/services/orders'
import { ScheduleList } from '@/components/schedule-list'
import { visitStatusTone } from '@/components/status-tones'
import { Badge } from '@/components/ui'
import Link from 'next/link'
import { TripsList } from '@/components/trips-list'
import { toDriverLegs } from '@/server/services/trip-views'
import { myTrips } from '@/server/services/trips'
import { myCustody } from '@/server/services/payments'
import { dashboardFigures } from '@/server/services/reports'
import { Figures } from '@/components/figures'

export default async function DashboardPage() {
  const actor = await requireActor()
  const locale = actor.locale
  const t = createTranslator(locale)
  const now = new Date()
  const opDate = operationalDateOf(now)
  const summary = can(actor, 'salaries.read') ? await staffSummary(actor) : null
  const mine = actor.role === 'specialist' ? await mySchedule(actor, opDate, opDate) : null
  const todays = can(actor, 'orders.read.all') ? await visitsOnOperationalDate(actor, opDate) : null
  const driverLegs = actor.role === 'driver' ? await myTrips(actor, opDate, opDate) : null
  const custody = actor.role === 'specialist' ? await myCustody(actor) : null
  const figures = can(actor, 'sales.read') ? await dashboardFigures(actor) : null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{t('dashboard.greeting', { name: actor.displayName })}</h1>
        <p className="text-sm text-muted">
          {t('dashboard.todayLabel')}: {formatDate(now, locale)} · <bdi>{formatTime(now, locale)}</bdi>
        </p>
      </div>

      <Card title={t('dashboard.operationalDay')} subtitle={t('dashboard.operationalDayHint')}>
        <p className="text-lg font-semibold text-brand-deep">{formatCalendarDate(opDate, locale)}</p>
      </Card>

      {summary && (
        <Card title={t('dashboard.staffCardTitle')} actions={<ButtonLink href="/staff" variant="secondary">{t('dashboard.manageStaff')}</ButtonLink>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Stat label={t('dashboard.activeStaff')} value={summary.activeCount} />
            <Stat
              label={t('dashboard.monthlySalaries')}
              value={formatMoney(summary.monthlySalaryTotalHalalas, locale)}
              hint={summary.withoutSalary > 0 ? t('dashboard.withoutSalary', { count: summary.withoutSalary }) : undefined}
            />
          </div>
        </Card>
      )}

      {can(actor, 'staff.manage') && (
        <Card title={t('dashboard.nextStepsTitle')}>
          <p className="text-sm text-muted">{t('dashboard.nextStepsBody')}</p>
        </Card>
      )}

      {custody && custody.totalHalalas > 0 && (
        <Card title={t('cash.myCustody')} subtitle={t('cash.myCustodyHint')}>
          <p className="text-xl font-bold text-brand-deep">{formatMoney(custody.totalHalalas, locale)}</p>
        </Card>
      )}

      {figures && <Figures data={figures} locale={locale} />}

      {mine && (
        <Card title={t('dashboard.scheduleTitle')} actions={<ButtonLink href="/schedule" variant="secondary">{t('schedule.upcoming')}</ButtonLink>}>
          <ScheduleList visits={mine} locale={locale} path="/" />
        </Card>
      )}
      {driverLegs && (
        <Card title={t('dashboard.tripsTitle')} actions={<ButtonLink href="/my-trips" variant="secondary">{t('schedule.upcoming')}</ButtonLink>}>
          <TripsList legs={toDriverLegs(driverLegs)} />
        </Card>
      )}
      {todays && (
        <Card title={t('orders.todayVisits')} actions={can(actor, 'orders.manage') ? <ButtonLink href="/orders/new">{t('orders.new')}</ButtonLink> : undefined}>
          {todays.length === 0 ? (
            <EmptyState body={t('orders.noVisitsToday')} />
          ) : (
            <ul className="divide-y divide-line">
              {todays.map((v) => (
                <li key={v.visitId}>
                  <Link href={`/orders/${v.orderId}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:bg-cream">
                    <bdi className="font-semibold text-ink">{v.startsAt ? formatTime(v.startsAt, locale) : '—'}</bdi>
                    <span className="flex-1 text-ink" dir="auto">
                      {v.customerName}
                    </span>
                    <span className="ltr-data text-muted">{v.reference}</span>
                    <Badge tone={visitStatusTone[v.status]}>{t(`visitStatus.${v.status}`)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title={t('dashboard.languageCardTitle')}>
        <p className="text-sm text-muted">{t('dashboard.languageCardBody', { language: t('meta.languageName') })}</p>
      </Card>
    </div>
  )
}
