'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import type { ActionState } from '@/server/actions'
import { createServiceAction, updatePackageAction, updateServiceAction } from './actions'

const initial = { ok: false } as ActionState<never>

function NamePriceFields({ d, fieldError }: { d?: { nameAr: string; nameEn: string; base: string; offer: string; active: boolean }; fieldError: (f: string) => string | undefined }) {
  const { t } = useI18n()
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('catalog.nameAr')} name="nameAr" error={fieldError('nameAr')}>
          {(p) => <input {...p} defaultValue={d?.nameAr} className={inputClass} dir="rtl" lang="ar" required />}
        </Field>
        <Field label={t('catalog.nameEn')} name="nameEn" error={fieldError('nameEn')}>
          {(p) => <input {...p} defaultValue={d?.nameEn} className={inputClass} dir="ltr" lang="en" required />}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('catalog.base')} name="base" error={fieldError('base')}>
          {(p) => <input {...p} defaultValue={d?.base} className={inputClass} inputMode="decimal" dir="ltr" required />}
        </Field>
        <Field label={t('catalog.offer')} name="offer" error={fieldError('offer') ?? fieldError('offerPrice')}>
          {(p) => <input {...p} defaultValue={d?.offer} className={inputClass} inputMode="decimal" dir="ltr" required />}
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="active" defaultChecked={d?.active ?? true} className="h-5 w-5 accent-[var(--color-brand-deep)]" />
        {t('catalog.active')}
      </label>
    </>
  )
}

export function ServiceForm({ id, d }: { id: string; d: { nameAr: string; nameEn: string; base: string; offer: string; active: boolean; duration: number } }) {
  const { t } = useI18n()
  const [state, action] = useActionState(updateServiceAction.bind(null, id), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormStatus state={state} successText={t('common.saved')} />
      <NamePriceFields d={d} fieldError={fieldError} />
      <Field label={t('catalog.duration')} name="duration" error={fieldError('durationMinutes')}>
        {(p) => <input {...p} type="number" min={5} max={600} defaultValue={d.duration} className={inputClass} dir="ltr" required />}
      </Field>
      <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
    </form>
  )
}

export function NewServiceForm({ categories }: { categories: { id: string; name: string }[] }) {
  const { t } = useI18n()
  const [state, action] = useActionState(createServiceAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3" key={state.ok ? state.at : 'new'}>
      <FormStatus state={state} successText={t('common.saved')} />
      <Field label={t('catalog.category')} name="categoryId" error={fieldError('categoryId')}>
        {(p) => (
          <select {...p} className={inputClass} required>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <NamePriceFields fieldError={fieldError} />
      <Field label={t('catalog.duration')} name="duration" error={fieldError('durationMinutes')}>
        {(p) => <input {...p} type="number" min={5} max={600} defaultValue={30} className={inputClass} dir="ltr" required />}
      </Field>
      <SubmitButton>{t('catalog.addService')}</SubmitButton>
    </form>
  )
}

export function PackageForm({ id, d }: { id: string; d: { nameAr: string; nameEn: string; base: string; offer: string; active: boolean; visitDuration: number; specialists: number } }) {
  const { t } = useI18n()
  const [state, action] = useActionState(updatePackageAction.bind(null, id), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormStatus state={state} successText={t('common.saved')} />
      <NamePriceFields d={d} fieldError={fieldError} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('catalog.visitDuration')} name="visitDuration" error={fieldError('visitDurationMinutes')}>
          {(p) => <input {...p} type="number" min={5} max={720} defaultValue={d.visitDuration} className={inputClass} dir="ltr" required />}
        </Field>
        <Field label={t('catalog.specialistsPerVisit')} name="specialists" error={fieldError('specialistsPerVisit')}>
          {(p) => <input {...p} type="number" min={1} max={6} defaultValue={d.specialists} className={inputClass} dir="ltr" required />}
        </Field>
      </div>
      <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
    </form>
  )
}
