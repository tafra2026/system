import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { inputClass } from '@/components/form-styles'
import { Alert, Badge, buttonStyles, Card, EmptyState, PageHeader } from '@/components/ui'
import { addDays, operationalDateOf } from '@/domain/operational-day'
import { createTranslator } from '@/i18n'
import { describeAppointment, formatCalendarDate, formatTime } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { dayPlan } from '@/server/services/trips'
import { LegEditor } from './leg-editor'
import { BuildingPhoto } from '@/components/building-photo'

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { actor, allowed } = await pagePermission('schedule.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const q = (await searchParams).date
  const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : operationalDateOf(new Date())
  const plan = await dayPlan(actor, date)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('trips.title')} subtitle={t('trips.subtitle')} />
      <form className="flex flex-wrap items-end gap-2">
        <Link href={`/trips?date=${addDays(date, -1)}`} className={buttonStyles.secondary}>
          {t('calendar.previous')}
        </Link>
        <input type="date" name="date" defaultValue={date} className={`${inputClass} max-w-48`} dir="ltr" aria-label={t('orders.from')} />
        <button type="submit" className={buttonStyles.secondary}>
          {t('orders.apply')}
        </button>
        <Link href={`/trips?date=${addDays(date, 1)}`} className={buttonStyles.secondary}>
          {t('calendar.next')}
        </Link>
      </form>
      <p className="text-sm font-semibold text-brand-deep">{formatCalendarDate(date, actor.locale)}</p>
      <Card title={t('trips.roster')}>
        <div className="flex flex-wrap gap-2">
          {plan.roster.map((r) => (
            <Badge key={r.id} tone={r.working ? 'success' : 'neutral'}>
              {r.name} · {t(`roles.${r.role}`)}
              {!r.working && ` · ${t('timeoff.offBadge')}`}
            </Badge>
          ))}
        </div>
      </Card>
      <Alert tone="info">{t('trips.estimateNote')}</Alert>
      {!plan.startPoint && <Alert tone="warning">{t('trips.noStartPoint')}</Alert>}
      {plan.visits.length === 0 ? (
        <Card>
          <EmptyState body={t('trips.noVisits')} />
        </Card>
      ) : (
        plan.visits.map((v) => {
          const appt = describeAppointment(v.startsAt, actor.locale)
          const origins = plan.visits.filter((o) => o.visitId !== v.visitId).map((o) => ({ visitId: o.visitId, label: `${t('trips.fromVisit', { reference: o.reference })} — ${o.address?.district ?? ''}` }))
          const legOf = (kind: 'dropoff' | 'pickup') => {
            const l = v.legs.find((x) => x.kind === kind)
            return l ? { driverEmployeeId: l.driverEmployeeId, driverName: l.driverName, originVisitId: l.originVisitId, travelMinutes: l.travelMinutes, travelSource: l.travelSource, bufferMinutes: l.bufferMinutes, departAt: l.departAt.toISOString(), arriveAt: l.arriveAt.toISOString(), blocking: l.blocking } : null
          }
          return (
            <Card
              key={v.visitId}
              title={
                <span>
                  <bdi>{appt.time}</bdi> – <bdi>{formatTime(v.endsAt, actor.locale)}</bdi> · <span dir="auto">{v.customerName}</span>
                </span>
              }
              subtitle={`${v.reference} · ${v.address?.district ?? ''} · ${v.specialists.map((s) => s.name).join('، ')}`}
              actions={
                <Link href={`/orders/${v.orderId}`} className="text-sm font-medium text-brand-deep underline">
                  {t('common.details')}
                </Link>
              }
            >
              {appt.afterMidnight && <p className="mb-2 text-xs text-warning">{t('datetime.afterMidnight', { date: appt.operationalDateLabel })}</p>}
              {v.buildingPhotoUrl && (
                <div className="mb-3 max-w-xs">
                  <BuildingPhoto url={v.buildingPhotoUrl} compact />
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {(['dropoff', 'pickup'] as const).map((kind) => (
                  <LegEditor
                    key={kind}
                    visitId={v.visitId}
                    kind={kind}
                    leg={legOf(kind)}
                    drivers={plan.drivers}
                    origins={origins}
                    suggestedDriverId={v.suggestedDriverId}
                    defaultBuffer={plan.defaultBuffer}
                    mapsReady={plan.mapsConfigured}
                    hasCoords={v.hasCoords}
                    startPointLabel={plan.startPoint?.label ?? null}
                  />
                ))}
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}
