'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { Badge } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import { setBufferAction, setDaysOffAction, setStartPointAction, setVipPackagesAction } from './actions'

const initial = { ok: false } as ActionState<never>

export function VipPackagesForm({ value }: { value: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setVipPackagesAction.bind(null, !value), initial)
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Badge tone={value ? 'success' : 'neutral'}>{value ? t('settings.on') : t('settings.off')}</Badge>
      <SubmitButton variant="secondary">{value ? t('settings.turnOff') : t('settings.turnOn')}</SubmitButton>
      <FormStatus state={state} successText={t('common.saved')} />
    </form>
  )
}

export function StartPointForm({ value }: { value: { label: string; latitude: number; longitude: number } | null }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setStartPointAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormStatus state={state} successText={t('common.saved')} />
      <Field label={t('settings.startPointLabel')} name="label" error={fieldError('label')}>
        {(p) => <input {...p} defaultValue={value?.label ?? ''} className={inputClass} dir="auto" maxLength={120} />}
      </Field>
      <Field label={t('settings.startPointLocation')} name="location" hint={t('customers.locationHint')} error={fieldError('location')}>
        {(p) => <input {...p} defaultValue={value ? `${value.latitude}, ${value.longitude}` : ''} className={inputClass} dir="ltr" />}
      </Field>
      <div className="flex gap-2">
        <SubmitButton>{t('common.save')}</SubmitButton>
        {value && (
          <SubmitButton variant="ghost" name="clear" value="1">
            {t('settings.clear')}
          </SubmitButton>
        )}
      </div>
    </form>
  )
}

export function BufferForm({ value }: { value: number }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setBufferAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="w-40">
        <Field label={t('settings.buffer')} name="buffer" error={fieldError('default_buffer_minutes')}>
          {(p) => <input {...p} type="number" min={10} max={15} defaultValue={value} className={inputClass} dir="ltr" />}
        </Field>
      </div>
      <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
      <div className="w-full">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
    </form>
  )
}

export function DaysOffForm({ weekly, dates }: { weekly: number[]; dates: string[] }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setDaysOffAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormStatus state={state} successText={t('common.saved')} />
      <fieldset>
        <legend className="text-sm font-medium text-ink">{t('settings.weeklyDaysOff')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['0', '1', '2', '3', '4', '5', '6'] as const).map((d) => (
            <label key={d} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm">
              <input type="checkbox" name="weekly" value={d} defaultChecked={weekly.includes(Number(d))} className="h-4 w-4 accent-[var(--color-brand-deep)]" />
              {t(`settings.weekdays.${d}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t('settings.specificDaysOff')} name="dates" hint={t('settings.specificDaysOffHint')} error={fieldError('dates')}>
        {(p) => <textarea {...p} defaultValue={dates.join('\n')} className={`${inputClass} min-h-24 py-2`} dir="ltr" />}
      </Field>
      <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
    </form>
  )
}
