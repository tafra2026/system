'use client'

import { Field, inputClass } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'

export const ROLES = ['owner', 'admin_manager', 'moderator', 'specialist', 'driver'] as const

export function EmployeeFields({
  fieldError,
  defaults,
}: {
  fieldError: (name: string) => string | undefined
  defaults?: { fullName?: string; displayNameEn?: string | null; phone?: string | null; notes?: string | null }
}) {
  const { t } = useI18n()
  return (
    <>
      <Field label={t('staff.fullName')} name="fullName" hint={t('staff.fullNameHint')} error={fieldError('fullName')}>
        {(p) => <input {...p} defaultValue={defaults?.fullName} className={inputClass} required maxLength={120} dir="auto" />}
      </Field>
      <Field label={t('staff.displayNameEn')} name="displayNameEn" hint={t('staff.displayNameEnHint')} error={fieldError('displayNameEn')} optional>
        {(p) => <input {...p} defaultValue={defaults?.displayNameEn ?? ''} className={inputClass} maxLength={120} dir="ltr" lang="en" />}
      </Field>
      <Field label={t('staff.phone')} name="phone" hint={t('staff.phoneHint')} error={fieldError('phone')} optional>
        {(p) => <input {...p} defaultValue={defaults?.phone ?? ''} className={inputClass} type="tel" inputMode="tel" dir="ltr" />}
      </Field>
      <Field label={t('staff.notes')} name="notes" error={fieldError('notes')} optional>
        {(p) => <textarea {...p} defaultValue={defaults?.notes ?? ''} className={`${inputClass} min-h-20 py-2`} maxLength={2000} dir="auto" />}
      </Field>
    </>
  )
}
