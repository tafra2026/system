'use client'

import { useActionState } from 'react'
import { markStartedAction } from '@/app/(app)/trips/actions'
import { FormStatus, SubmitButton } from './form'
import { useI18n } from './i18n-provider'
import { Badge, EmptyState } from './ui'
import { BuildingPhoto } from './building-photo'
import { MessageTaskActions } from './message-task'
import { formatTime } from '@/i18n/format'
import type { ActionState } from '@/server/actions'

export interface DriverLeg {
  legId: string
  kind: 'dropoff' | 'pickup'
  departAt: string
  arriveAt: string
  startedAt: string | null
  reference: string
  customerName: string
  destination: { district: string; addressLine: string | null; mapUrl: string | null; photoUrl: string | null; thumbUrl?: string | null } | null
  origin: { label: string; mapUrl: string | null }
  specialists: string[]
  /** "On the way" WhatsApp message assigned to this driver, once she started heading out. */
  messageTask: { id: string; status: 'ready' | 'opened' | 'sent' | 'cancelled' } | null
}

function StartButton({ legId }: { legId: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(markStartedAction.bind(null, legId), { ok: false } as ActionState<never>)
  return (
    <form action={action}>
      <FormStatus state={state} />
      <SubmitButton>{t('trips.startedHeading')}</SubmitButton>
    </form>
  )
}

/** Driver's legs: planned times (estimates), places, who to carry. No prices or phone numbers. */
export function TripsList({ legs }: { legs: DriverLeg[] }) {
  const { t, locale } = useI18n()
  if (legs.length === 0) return <EmptyState body={t('trips.myEmpty')} />
  return (
    <ul className="flex flex-col gap-3">
      {legs.map((l) => (
        <li key={l.legId} className="rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone={l.kind === 'dropoff' ? 'brand' : 'warning'}>{l.kind === 'dropoff' ? t('trips.dropoff') : t('trips.pickup')}</Badge>
            <span className="ltr-data text-xs text-muted">{l.reference}</span>
          </div>
          <p className="mt-1 text-sm text-ink">
            {t('trips.plannedDepart')}: <strong><bdi>{formatTime(new Date(l.departAt), locale)}</bdi></strong> · {t('trips.expectedArrival')}: <strong><bdi>{formatTime(new Date(l.arriveAt), locale)}</bdi></strong>
          </p>
          <p className="text-sm text-muted">
            {t('trips.origin')}: <span dir="auto">{l.origin.label}</span>
          </p>
          {l.destination && (
            <p className="text-sm text-ink" dir="auto">
              {t('trips.destination')}: {l.customerName} — {l.destination.district}
              {l.destination.addressLine ? `${t('common.listSeparator')}${l.destination.addressLine}` : ''}
            </p>
          )}
          <p className="text-sm text-muted">
            {t('trips.specialistsToCarry')}: {l.specialists.join(t('common.listSeparator'))}
          </p>
          {l.destination?.photoUrl && <BuildingPhoto url={l.destination.photoUrl} thumbUrl={l.destination.thumbUrl} compact />}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {l.destination?.mapUrl && (
              <a href={l.destination.mapUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-deep underline">
                {t('trips.openMap')}
              </a>
            )}
            {l.kind === 'dropoff' && (l.startedAt ? <span className="text-sm text-success">{t('trips.startedAt', { time: formatTime(new Date(l.startedAt), locale) })}</span> : <StartButton legId={l.legId} />)}
          </div>
          {l.messageTask && (
            <div className="mt-2 flex flex-col gap-1">
              <p className="text-sm font-semibold text-ink">{l.messageTask.status === 'sent' ? t('messages.onTheWaySent') : t('messages.kinds.on_the_way')}</p>
              <MessageTaskActions taskId={l.messageTask.id} status={l.messageTask.status} canDismiss={false} />
            </div>
          )}
        </li>
      ))}
      <li className="text-xs text-muted">{t('trips.estimateNote')}</li>
    </ul>
  )
}
