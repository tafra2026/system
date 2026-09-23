'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { Alert, buttonStyles } from '@/components/ui'
import type { Locale } from '@/i18n/types'
import { setupAction } from './actions'

export function SetupForm({ token, defaultLocale }: { token: string; defaultLocale: Locale }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setupAction.bind(null, token), { ok: false })
  const fieldError = useFieldErrors(state)
  if (state.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{t('auth.setupDone')}</Alert>
        <Link href="/login" className={buttonStyles.primary}>
          {t('auth.goToLogin')}
        </Link>
      </div>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStatus state={state} />
      <Field label={t('auth.preferredLanguage')} name="locale">
        {(p) => (
          <select {...p} defaultValue={defaultLocale} className={inputClass}>
            <option value="en" lang="en">English</option>
            <option value="ar" lang="ar">العربية</option>
          </select>
        )}
      </Field>
      <Field label={t('auth.newPassword')} name="password" hint={t('auth.passwordRule')} error={fieldError('password')}>
        {(p) => <input {...p} type="password" minLength={10} className={inputClass} autoComplete="new-password" required dir="ltr" />}
      </Field>
      <Field label={t('auth.confirmPassword')} name="confirm" error={fieldError('confirm')}>
        {(p) => <input {...p} type="password" minLength={10} className={inputClass} autoComplete="new-password" required dir="ltr" />}
      </Field>
      <SubmitButton className="w-full">{t('auth.activate')}</SubmitButton>
    </form>
  )
}
