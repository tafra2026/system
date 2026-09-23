'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { forcedChangePasswordAction } from './actions'

export function ChangePasswordForm() {
  const { t } = useI18n()
  const [state, action] = useActionState(forcedChangePasswordAction, { ok: false })
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStatus state={state} />
      <Field label={t('auth.temporaryPassword')} name="currentPassword" error={fieldError('currentPassword')}>
        {(p) => <input {...p} type="password" className={inputClass} autoComplete="current-password" required dir="ltr" />}
      </Field>
      <Field label={t('auth.newPassword')} name="newPassword" hint={t('auth.passwordRule')} error={fieldError('newPassword') ?? fieldError('password')}>
        {(p) => <input {...p} type="password" minLength={10} className={inputClass} autoComplete="new-password" required dir="ltr" />}
      </Field>
      <Field label={t('auth.confirmPassword')} name="confirm" error={fieldError('confirm')}>
        {(p) => <input {...p} type="password" minLength={10} className={inputClass} autoComplete="new-password" required dir="ltr" />}
      </Field>
      <SubmitButton className="w-full">{t('auth.savePassword')}</SubmitButton>
    </form>
  )
}
