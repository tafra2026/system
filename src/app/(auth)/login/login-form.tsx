'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { loginAction } from './actions'

export function LoginForm() {
  const { t } = useI18n()
  const [state, action] = useActionState(loginAction, { ok: false })
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStatus state={state} />
      <Field label={t('auth.username')} name="username">
        {(p) => <input {...p} className={`${inputClass} ltr-data`} autoComplete="username" autoCapitalize="none" spellCheck={false} required dir="ltr" />}
      </Field>
      <Field label={t('auth.password')} name="password">
        {(p) => <input {...p} type="password" className={inputClass} autoComplete="current-password" required dir="ltr" />}
      </Field>
      <SubmitButton pendingLabel={t('auth.signingIn')} className="w-full">
        {t('auth.signIn')}
      </SubmitButton>
    </form>
  )
}
