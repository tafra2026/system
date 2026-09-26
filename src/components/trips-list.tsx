'use client'

import { useState, useTransition } from 'react'
import { legStepAction, markStartedAction } from '@/app/(app)/trips/actions'
import { translateError } from '@/i18n'
import { formatCalendarDate, formatTime } from '@/i18n/format'
import type { ActionState } from '@/server/actions'
import { BuildingPhoto } from './building-photo'
import { CopyButton } from './copy-button'
import { useI18n } from './i18n-provider'
import { MessageTaskActions } from './message-task'
import { useOnline } from './online-status'
import { Badge, buttonStyles, EmptyState } from './ui'

export interface DriverLeg {
  legId: string
  kind: 'dropoff' | 'pickup'
  departAt: string
  arriveAt: string
  startedAt: string | null
  acceptedAt?: string | null
  arrivedAt?: string | null
  completedAt?: string | null
  operationalDate?: string | null
  reference: string
  customerName: string
  destination: { district: string; addressLine: string | null; mapUrl: string | null; photoUrl: string | null; thumbUrl?: string | null } | null
  origin: { label: string; mapUrl: string | null }
  specialists: string[]
  /** "On the way" WhatsApp message assigned to this driver, once she started heading out. */
  messageTask: { id: string; status: 'ready' | 'opened' | 'sent' | 'cancelled' } | null
}

type Step = 'accept' | 'start' | 'arrive' | 'complete'

function nextStep(l: DriverLeg): Step | null {
  if (l.completedAt) return null
  if (!l.acceptedAt && !l.startedAt) return 'accept'
  if (!l.startedAt) return 'start'
  if (!l.arrivedAt) return 'arrive'
  return 'complete'
}

function StepButton({ leg }: { leg: DriverLeg }) {
  const { t } = useI18n()
  const online = useOnline()
  const [pending, start] = useTransition()
  const [error, setError] = useState<ActionState | null>(null)
  const step = nextStep(leg)
  if (!step) return null
  const label = step === 'accept' ? t('trips.accept') : step === 'start' ? t('trips.startedHeading') : step === 'arrive' ? t('trips.arrived') : leg.kind === 'dropoff' ? t('trips.dropoffDone') : t('trips.pickupDone')
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={`${buttonStyles.primary} w-full`}
        disabled={pending || !online}
        onClick={() =>
          start(async () => {
            const r = step === 'start' ? await markStartedAction(leg.legId) : await legStepAction(leg.legId, step)
            setError(r.ok ? null : r)
          })
        }
      >
        {pending ? t('common.saving') : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {translateError(t, error.error)}
        </p>
      )}
    </div>
  )
}

function Progress({ leg }: { leg: DriverLeg }) {
  const { t, locale } = useI18n()
  const steps: [string, string | null | undefined][] = [
    [t('trips.stepAccepted'), leg.acceptedAt ?? leg.startedAt],
    [t('trips.stepStarted'), leg.startedAt],
    [t('trips.stepArrived'), leg.arrivedAt],
    [leg.kind === 'dropoff' ? t('trips.stepDropoff') : t('trips.stepPickup'), leg.completedAt],
  ]
  return (
    <ol className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
      {steps.map(([label, at]) => (
        <li key={label} className={`rounded-lg border px-2 py-1 ${at ? 'border-success/40 bg-success-soft text-success' : 'border-line text-muted'}`}>
          {at ? '✓ ' : ''}
          {label}
          {at && <bdi className="block">{formatTime(new Date(at), locale)}</bdi>}
        </li>
      ))}
    </ol>
  )
}

/** Driver's legs: planned times (estimates), places, who to carry. No prices or phone numbers. */
export function TripsList({ legs }: { legs: DriverLeg[] }) {
  const { t, locale } = useI18n()
  if (legs.length === 0) return <EmptyState body={t('trips.myEmpty')} />
  return (
    <ul className="flex flex-col gap-3">
      {legs.map((l) => (
        <li key={l.legId} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xl font-bold text-ink">
              <bdi>{formatTime(new Date(l.departAt), locale)}</bdi>
            </p>
            <div className="flex flex-wrap gap-1">
              <Badge tone={l.kind === 'dropoff' ? 'brand' : 'warning'}>{l.kind === 'dropoff' ? t('trips.dropoff') : t('trips.pickup')}</Badge>
              {l.completedAt ? <Badge tone="success">{t('trips.done')}</Badge> : l.startedAt ? <Badge tone="warning">{t('trips.inProgress')}</Badge> : <Badge>{t('trips.upcoming')}</Badge>}
            </div>
          </div>
          {l.operationalDate && <p className="text-xs text-muted">{formatCalendarDate(l.operationalDate, locale)}</p>}
          <p className="text-sm text-ink">
            <span className="font-semibold" dir="auto">
              {l.customerName}
            </span>{' '}
            · <span className="ltr-data text-muted">{l.reference}</span>
          </p>
          {l.destination && (
            <p className="text-sm text-ink" dir="auto">
              {l.destination.district}
              {l.destination.addressLine ? `${t('common.listSeparator')}${l.destination.addressLine}` : ''}
            </p>
          )}
          <p className="text-sm text-muted">
            {t('trips.expectedArrival')}: <bdi className="font-semibold text-ink">{formatTime(new Date(l.arriveAt), locale)}</bdi> · {t('trips.origin')}: <span dir="auto">{l.origin.label}</span>
          </p>
          <p className="text-sm text-muted">
            {t('trips.specialistsToCarry')}: <span className="text-ink">{l.specialists.join(t('common.listSeparator')) || '—'}</span>
          </p>
          <Progress leg={l} />
          {l.destination?.photoUrl && <BuildingPhoto url={l.destination.photoUrl} thumbUrl={l.destination.thumbUrl} compact />}
          <div className="grid grid-cols-2 gap-2">
            {l.destination?.mapUrl && (
              <a href={l.destination.mapUrl} target="_blank" rel="noreferrer" className={buttonStyles.secondary}>
                {t('trips.openMap')}
              </a>
            )}
            {l.destination?.mapUrl && <CopyButton value={l.destination.mapUrl} label={t('trips.copyLocation')} />}
          </div>
          <StepButton leg={l} />
          {l.messageTask && (
            <div className="flex flex-col gap-1">
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
