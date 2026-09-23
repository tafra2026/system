'use client'

import { useActionState } from 'react'
import { adjustCommissionAction } from '@/app/(app)/payments/actions'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import type { ActionState } from '@/server/actions'

export function AdjustCommissionForm({ employees }: { employees: { id: string; name: string }[] }) {
  const { t } = useI18n()
  const [state, action] = useActionState(adjustCommissionAction, { ok: false } as ActionState<never>)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4" key={state.ok ? state.at : 'f'}>
      <div className="sm:col-span-4">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
      <Field label={t('commissions.employee')} name="employeeId">
        {(p) => (
          <select {...p} className={inputClass}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('commissions.adjustAmount')} name="amount" error={fieldError('amount')}>
        {(p) => <input {...p} className={inputClass} dir="ltr" required />}
      </Field>
      <Field label={t('common.reason')} name="reason" error={fieldError('reason')}>
        {(p) => <input {...p} className={inputClass} dir="auto" required />}
      </Field>
      <SubmitButton variant="secondary">{t('commissions.adjust')}</SubmitButton>
    </form>
  )
}
