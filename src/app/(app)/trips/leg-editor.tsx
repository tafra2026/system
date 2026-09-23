'use client'

import { useActionState } from 'react'
import { FormStatus, inputClass, SubmitButton } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { Badge, buttonStyles } from '@/components/ui'
import { formatTime } from '@/i18n/format'
import type { ActionState } from '@/server/actions'
import { removeLegAction, saveLegAction } from './actions'

const initial = { ok: false } as ActionState<never>

export interface LegView {
  driverEmployeeId: string
  driverName: string
  originVisitId: string | null
  travelMinutes: number
  travelSource: 'google' | 'manual'
  bufferMinutes: number
  departAt: string
  arriveAt: string
  blocking: boolean
}

export function LegEditor({
  visitId,
  kind,
  leg,
  drivers,
  origins,
  suggestedDriverId,
  defaultBuffer,
  mapsReady,
  hasCoords,
  startPointLabel,
}: {
  visitId: string
  kind: 'dropoff' | 'pickup'
  leg: LegView | null
  drivers: { id: string; name: string }[]
  origins: { visitId: string; label: string }[]
  suggestedDriverId: string | null
  defaultBuffer: number
  mapsReady: boolean
  hasCoords: boolean
  startPointLabel: string | null
}) {
  const { t, locale } = useI18n()
  const [state, action] = useActionState(saveLegAction.bind(null, visitId, kind), initial)
  const [removeState, remove] = useActionState(removeLegAction.bind(null, visitId, kind), initial)
  const googleUsable = mapsReady && hasCoords
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{kind === 'dropoff' ? t('trips.dropoff') : t('trips.pickup')}</p>
        {leg ? <Badge tone={leg.travelSource === 'google' ? 'success' : 'brand'}>{t(`trips.source.${leg.travelSource}`)}</Badge> : <Badge>{t('trips.noLeg')}</Badge>}
      </div>
      {leg ? (
        <p className="mb-2 text-sm text-ink">
          {leg.driverName} · {t('trips.plannedDepart')} <bdi className="font-semibold">{formatTime(new Date(leg.departAt), locale)}</bdi> · {t('trips.expectedArrival')}{' '}
          <bdi className="font-semibold">{formatTime(new Date(leg.arriveAt), locale)}</bdi>
          <span className="block text-xs text-muted">
            {t('trips.travel')}: {leg.travelMinutes} · {t('trips.buffer')}: {leg.bufferMinutes}
          </span>
        </p>
      ) : (
        <p className="mb-2 text-xs text-warning">{t('trips.notCalculated')}</p>
      )}
      <form action={action} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormStatus state={state} successText={t('common.saved')} />
          <FormStatus state={removeState} />
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          {t('trips.driver')}
          <select name="driverId" defaultValue={leg?.driverEmployeeId ?? suggestedDriverId ?? ''} className={inputClass} required>
            <option value="" disabled>
              —
            </option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.id === suggestedDriverId ? ` (${t('trips.suggested')})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          {t('trips.origin')}
          <select name="origin" defaultValue={leg?.originVisitId ?? ''} className={inputClass}>
            <option value="">{startPointLabel ? t('trips.startPoint', { label: startPointLabel }) : t('trips.noStartPoint')}</option>
            {origins.map((o) => (
              <option key={o.visitId} value={o.visitId}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          {t('trips.travel')}
          <input name="travelMinutes" type="number" min={1} max={300} defaultValue={leg?.travelMinutes ?? ''} className={inputClass} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          {t('trips.buffer')}
          <input name="bufferMinutes" type="number" min={10} max={15} defaultValue={leg?.bufferMinutes ?? defaultBuffer} className={inputClass} dir="ltr" required />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <SubmitButton name="mode" value="manual" variant="secondary">
            {t('trips.saveManual')}
          </SubmitButton>
          {googleUsable && (
            <SubmitButton name="mode" value="google">
              {t('trips.calcGoogle')}
            </SubmitButton>
          )}
          {leg && (
            <button type="submit" formAction={remove} className={buttonStyles.ghost} formNoValidate>
              {t('trips.remove')}
            </button>
          )}
        </div>
        {!googleUsable && <p className="text-xs text-muted sm:col-span-2">{mapsReady ? t('trips.coordsMissing') : t('trips.mapsOff')}</p>}
      </form>
    </div>
  )
}
