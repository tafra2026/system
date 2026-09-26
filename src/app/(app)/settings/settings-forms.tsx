'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { Badge } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import { setBusinessContactAction, setBufferAction, setDaysOffAction, setMessageOptionsAction, setMessageTemplatesAction, setStartPointAction, setVipPackagesAction } from './actions'
import { DEFAULT_MESSAGE_TEMPLATES, MESSAGE_KINDS, MESSAGE_PLACEHOLDERS, type MessageKind, type MessageLocale } from '@/domain/messages'

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

export function MessageTemplatesForm({ custom }: { custom: Partial<Record<MessageKind, Partial<Record<MessageLocale, string>>>> }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setMessageTemplatesAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-xs text-muted">
        {t('settings.templatesHint')} <span className="ltr-data">{MESSAGE_PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}</span>
      </p>
      {MESSAGE_KINDS.map((kind) => (
        <fieldset key={kind} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">{t(`messages.kinds.${kind}`)}</legend>
          {(['ar', 'en'] as const).map((loc) => (
            <Field key={loc} label={loc === 'ar' ? 'العربية' : 'English'} name={`${kind}.${loc}`} error={fieldError(`${kind}.${loc}`)}>
              {(p) => (
                <textarea
                  {...p}
                  rows={6}
                  lang={loc}
                  dir={loc === 'ar' ? 'rtl' : 'ltr'}
                  maxLength={2000}
                  defaultValue={custom[kind]?.[loc] ?? DEFAULT_MESSAGE_TEMPLATES[kind][loc]}
                  className={inputClass}
                />
              )}
            </Field>
          ))}
        </fieldset>
      ))}
      <FormStatus state={state} successText={t('common.saved')} />
      <SubmitButton>{t('common.save')}</SubmitButton>
    </form>
  )
}

export function MessageOptionsForm({ reviewLink, sender }: { reviewLink: string | null; sender: 'driver' | 'moderator' }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setMessageOptionsAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label={t('settings.reviewLink')} name="reviewLink" hint={t('settings.reviewLinkHint')} error={fieldError('review_link')}>
        {(p) => <input {...p} type="url" defaultValue={reviewLink ?? ''} placeholder="https://" className={`${inputClass} ltr-data`} dir="ltr" maxLength={500} />}
      </Field>
      <Field label={t('settings.onTheWaySender')} name="onTheWaySender" hint={t('settings.onTheWaySenderHint')}>
        {(p) => (
          <select {...p} defaultValue={sender} className={inputClass}>
            <option value="driver">{t('settings.senderDriver')}</option>
            <option value="moderator">{t('settings.senderModerator')}</option>
          </select>
        )}
      </Field>
      <FormStatus state={state} successText={t('common.saved')} />
      <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
    </form>
  )
}

export function BusinessContactForm({ value }: { value: { phone?: string; email?: string; address?: string; website?: string } | null }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setBusinessContactAction, initial)
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label={t('settings.contactPhone')} name="phone">
        {(p) => <input {...p} defaultValue={value?.phone ?? ''} className={`${inputClass} ltr-data`} dir="ltr" maxLength={40} />}
      </Field>
      <Field label={t('settings.contactEmail')} name="email">
        {(p) => <input {...p} type="email" defaultValue={value?.email ?? ''} className={`${inputClass} ltr-data`} dir="ltr" maxLength={120} />}
      </Field>
      <Field label={t('settings.contactWebsite')} name="website">
        {(p) => <input {...p} defaultValue={value?.website ?? ''} className={`${inputClass} ltr-data`} dir="ltr" maxLength={120} />}
      </Field>
      <Field label={t('settings.contactAddress')} name="address">
        {(p) => <input {...p} defaultValue={value?.address ?? ''} className={inputClass} dir="auto" maxLength={200} />}
      </Field>
      <div className="sm:col-span-2 flex flex-col gap-2">
        <FormStatus state={state} successText={t('common.saved')} />
        <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
      </div>
    </form>
  )
}
