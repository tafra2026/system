import { directionsLink, mapsLink } from '@/domain/order'
import { CopyButton } from './copy-button'
import { BuildingPhoto } from './building-photo'
import { createTranslator } from '@/i18n'
import { describeAppointment } from '@/i18n/format'
import type { Locale } from '@/i18n/types'
import type { mySchedule } from '@/server/services/orders'
import { CompleteVisitButton } from '@/app/(app)/orders/[id]/order-forms'
import { visitStatusTone } from './status-tones'
import { Badge, EmptyState } from './ui'
import { RecordPaymentForm } from './payment-forms'
import { formatMoney } from '@/i18n/format'
import { toSarString } from '@/domain/money'

type Visit = Awaited<ReturnType<typeof mySchedule>>[number]

/** A specialist's visits: time, place, her tasks. No prices. */
export function ScheduleList({ visits, locale, path }: { visits: Visit[]; locale: Locale; path: string }) {
  const t = createTranslator(locale)
  if (visits.length === 0) return <EmptyState body={t('schedule.empty')} />
  return (
    <ul className="flex flex-col gap-3">
      {visits.map((v) => {
        const appt = describeAppointment(v.startsAt, locale)
        const mine = v.items.filter((i) => i.mine || i.unassigned)
        const others = v.items.filter((i) => !i.mine && !i.unassigned)
        return (
          <li key={v.visitId} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-ink">
                {appt.date} · <bdi>{appt.time}</bdi>
              </p>
              <Badge tone={visitStatusTone[v.status]}>{t(`visitStatus.${v.status}`)}</Badge>
            </div>
            {appt.afterMidnight && <p className="text-xs text-warning">{t('datetime.afterMidnight', { date: appt.operationalDateLabel })}</p>}
            <p className="text-sm text-muted">
              {t('orders.minutes', { n: v.durationMinutes })} · <span className="ltr-data">{v.reference}</span>
            </p>
            <p className="mt-1 text-sm text-ink" dir="auto">
              {v.customerName}
              {v.address && ` — ${v.address.district}${v.address.addressLine ? `${t('common.listSeparator')}${v.address.addressLine}` : ''}`}
            </p>
            {v.address?.buildingDetails && (
              <p className="text-sm text-muted" dir="auto">
                {v.address.buildingDetails}
              </p>
            )}
            {v.address?.accessInstructions && (
              <p className="text-sm text-muted" dir="auto">
                {t('schedule.access')}: {v.address.accessInstructions}
              </p>
            )}
            {v.buildingPhotoUrl && <BuildingPhoto url={v.buildingPhotoUrl} />}
            {v.address && (
              <div className="mt-2 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {v.address.latitude != null && v.address.longitude != null && (
                    <>
                      <a href={directionsLink(v.address.latitude, v.address.longitude)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-brand-deep px-3 text-sm font-semibold text-white">
                        {t('schedule.directions')}
                      </a>
                      <a href={mapsLink(v.address.latitude, v.address.longitude)} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-deep underline">
                        {t('customers.openMap')}
                      </a>
                    </>
                  )}
                  <CopyButton
                    label={t('schedule.copyLocation')}
                    value={[
                      [v.address.district, v.address.addressLine, v.address.buildingDetails].filter(Boolean).join(t('common.listSeparator')),
                      v.address.latitude != null && v.address.longitude != null ? mapsLink(v.address.latitude, v.address.longitude) : null,
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  />
                </div>
                <p className="text-xs text-muted">{t('schedule.copyHint')}</p>
              </div>
            )}
            {v.team.length > 0 && (
              <p className="mt-1 text-sm text-muted">
                {t('schedule.team')}: {v.team.join(t('common.listSeparator'))}
              </p>
            )}
            <div className="mt-2">
              <p className="text-xs font-semibold text-ink">{t('schedule.myTasks')}</p>
              <ul className="text-sm text-ink">
                {mine.map((i, n) => (
                  <li key={n} dir="auto">
                    • {i.name}
                    {v.personsCount > 1 && i.beneficiaryIndex != null && <span className="text-xs text-muted"> · {t('orders.beneficiary', { n: i.beneficiaryIndex })}</span>}
                    <span className="text-xs text-muted"> · {t('orders.minutes', { n: i.minutes })}</span>
                  </li>
                ))}
              </ul>
              {others.length > 0 && (
                <>
                  <p className="mt-1 text-xs font-semibold text-muted">{t('schedule.otherTasks')}</p>
                  <ul className="text-xs text-muted">
                    {others.map((i, n) => (
                      <li key={n} dir="auto">
                        • {i.name}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {v.notes && (
              <p className="mt-1 text-sm text-muted" dir="auto">
                {v.notes}
              </p>
            )}
            <div className="mt-2 rounded-xl bg-cream/70 p-2 text-sm">
              {v.remainingHalalas > 0 ? (
                <>
                  <p className="mb-2 font-semibold text-ink">
                    {t('payments.remainingToCollect')}: {formatMoney(v.remainingHalalas, locale)}
                  </p>
                  <RecordPaymentForm orderId={v.orderId} path={path} methods={['cash', 'pos']} remainingSar={toSarString(v.remainingHalalas)} compact />
                </>
              ) : (
                <p className="text-success">{t('payments.fullyPaid')}</p>
              )}
            </div>
            {v.status === 'scheduled' && (
              <div className="mt-2">
                <CompleteVisitButton path={path} visitId={v.visitId} label={t('schedule.markDone')} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
