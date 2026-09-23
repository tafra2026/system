import { Forbidden } from '@/components/forbidden'
import { ScheduleList } from '@/components/schedule-list'
import { Card, PageHeader } from '@/components/ui'
import { addDays, operationalDateOf } from '@/domain/operational-day'
import { createTranslator } from '@/i18n'
import { formatCalendarDate } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { mySchedule } from '@/server/services/orders'

export default async function SchedulePage() {
  const { actor, allowed } = await pagePermission('schedule.read.own')
  const t = createTranslator(actor.locale)
  if (!allowed || actor.role !== 'specialist') return <Forbidden message={t('errors.forbidden')} />
  const today = operationalDateOf(new Date())
  const [current, upcoming] = await Promise.all([mySchedule(actor, today, today), mySchedule(actor, addDays(today, 1), addDays(today, 14))])
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('schedule.title')} />
      <Card title={t('schedule.today')} subtitle={formatCalendarDate(today, actor.locale)}>
        <ScheduleList visits={current} locale={actor.locale} path="/schedule" />
      </Card>
      <Card title={t('schedule.upcoming')}>
        <ScheduleList visits={upcoming} locale={actor.locale} path="/schedule" />
      </Card>
    </div>
  )
}
