'use client'

import { useActionState } from 'react'
import { handoverAction } from '@/app/(app)/payments/actions'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import type { ActionState } from '@/server/actions'

export function HandoverForm({ employeeId, expectedSar }: { employeeId: string; expectedSar: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(handoverAction.bind(null, employeeId), { ok: false } as ActionState<never>)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
      <div className="sm:col-span-3">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
      <Field label={t('cash.actual')} name="actual" error={fieldError('actual')}>
        {(p) => <input {...p} defaultValue={expectedSar} className={inputClass} inputMode="decimal" dir="ltr" required />}
      </Field>
      <Field label={t('cash.reason')} name="reason" error={fieldError('reason')} optional>
        {(p) => <input {...p} className={inputClass} dir="auto" maxLength={500} />}
      </Field>
      <SubmitButton>{t('cash.receive')}</SubmitButton>
    </form>
  )
}
