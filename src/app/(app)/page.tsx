import { ButtonLink, Card, EmptyState, Stat } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatCalendarDate, formatDate, formatMoney, formatTime } from '@/i18n/format'
import { operationalDateOf } from '@/domain/operational-day'
import { can } from '@/server/authz/actor'
import { requireActor } from '@/server/auth/current'
import { staffSummary } from '@/server/services/staff'

export default async function DashboardPage() {
  const actor = await requireActor()
  const locale = actor.locale
  const t = createTranslator(locale)
  const now = new Date()
  const opDate = operationalDateOf(now)
  const summary = can(actor, 'salaries.read') ? await staffSummary(actor) : null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{t('dashboard.greeting', { name: actor.displayName })}</h1>
        <p className="text-sm text-muted">
          {t('dashboard.todayLabel')}: {formatDate(now, locale)} · <span className="ltr-data">{formatTime(now, locale)}</span>
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

      {actor.role === 'specialist' && (
        <Card title={t('dashboard.scheduleTitle')}>
          <EmptyState body={t('dashboard.scheduleEmpty')} />
        </Card>
      )}
      {actor.role === 'driver' && (
        <Card title={t('dashboard.tripsTitle')}>
          <EmptyState body={t('dashboard.tripsEmpty')} />
        </Card>
      )}
      {can(actor, 'orders.manage') && (
        <Card title={t('dashboard.bookingsTitle')}>
          <EmptyState body={t('dashboard.bookingsEmpty')} />
        </Card>
      )}

      <Card title={t('dashboard.languageCardTitle')}>
        <p className="text-sm text-muted">{t('dashboard.languageCardBody', { language: t('meta.languageName') })}</p>
      </Card>
    </div>
  )
}
