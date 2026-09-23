'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import type { ActionState } from '@/server/actions'
import { changePasswordAction, setLocaleAction } from './actions'

const initial = { ok: false } as ActionState<never>

export function LanguageForm() {
  const { t, locale } = useI18n()
  const [state, action] = useActionState(setLocaleAction, initial)
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('account.languageHint')}</p>
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('common.language')}>
        {(['ar', 'en'] as const).map((l) => (
          <SubmitButton key={l} name="locale" value={l} variant={l === locale ? 'primary' : 'secondary'}>
            <span lang={l}>{l === 'ar' ? 'العربية' : 'English'}</span>
          </SubmitButton>
        ))}
      </div>
    </form>
  )
}

export function PasswordForm() {
  const { t } = useI18n()
  const [state, action] = useActionState(changePasswordAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormStatus state={state} successText={t('account.passwordChanged')} />
      <Field label={t('account.currentPassword')} name="currentPassword" error={fieldError('currentPassword')}>
        {(p) => <input {...p} type="password" className={inputClass} autoComplete="current-password" required dir="ltr" />}
      </Field>
      <Field label={t('account.newPassword')} name="newPassword" hint={t('auth.passwordRule')} error={fieldError('newPassword') ?? fieldError('password')}>
        {(p) => <input {...p} type="password" minLength={10} className={inputClass} autoComplete="new-password" required dir="ltr" />}
      </Field>
      <Field label={t('auth.confirmPassword')} name="confirm" error={fieldError('confirm')}>
        {(p) => <input {...p} type="password" minLength={10} className={inputClass} autoComplete="new-password" required dir="ltr" />}
      </Field>
      <SubmitButton>{t('common.save')}</SubmitButton>
    </form>
  )
}
