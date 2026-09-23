import { Forbidden } from '@/components/forbidden'
import { TripsList } from '@/components/trips-list'
import { Card, PageHeader } from '@/components/ui'
import { addDays, operationalDateOf } from '@/domain/operational-day'
import { createTranslator } from '@/i18n'
import { formatCalendarDate } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { myTeam } from '@/server/services/teams'
import { toDriverLegs } from '@/server/services/trip-views'
import { myTrips } from '@/server/services/trips'
import { myOnTheWayTasks } from '@/server/services/messages'

export default async function MyTripsPage() {
  const { actor, allowed } = await pagePermission('schedule.read.own')
  const t = createTranslator(actor.locale)
  if (!allowed || actor.role !== 'driver') return <Forbidden message={t('errors.forbidden')} />
  const today = operationalDateOf(new Date())
  const [current, upcoming, team] = await Promise.all([myTrips(actor, today, today), myTrips(actor, addDays(today, 1), addDays(today, 7)), myTeam(actor)])
  const onTheWay = await myOnTheWayTasks(actor, current.map((l) => l.visitId))
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('trips.myTitle')} />
      <Card title={t('schedule.today')} subtitle={formatCalendarDate(today, actor.locale)}>
        <TripsList legs={toDriverLegs(current, onTheWay)} />
      </Card>
      <Card title={t('schedule.upcoming')}>
        <TripsList legs={toDriverLegs(upcoming)} />
      </Card>
      <Card title={t('trips.team')}>
        {team ? (
          <p className="text-sm text-ink">
            <strong>{team.name}</strong>: {team.members.map((m) => `${m.name} (${t(`roles.${m.role}`)})`).join(actor.locale === 'ar' ? '، ' : ', ')}
          </p>
        ) : (
          <p className="text-sm text-muted">{t('trips.noTeam')}</p>
        )}
      </Card>
    </div>
  )
}
