'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { createEmployeeAction } from '../actions'
import { EmployeeFields, ROLES } from '../employee-fields'

export function NewEmployeeForm({ defaultEffectiveFrom }: { defaultEffectiveFrom: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(createEmployeeAction, { ok: false })
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStatus state={state} />
      <EmployeeFields fieldError={fieldError} />
      <Field label={t('staff.role')} name="role" error={fieldError('role')}>
        {(p) => (
          <select {...p} className={inputClass} required defaultValue="specialist">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('staff.initialSalary')} name="salary" hint={t('staff.initialSalaryHint')} error={fieldError('salary') ?? fieldError('amount')} optional>
          {(p) => <input {...p} className={inputClass} inputMode="decimal" dir="ltr" />}
        </Field>
        <Field label={t('staff.effectiveFrom')} name="effectiveFrom" error={fieldError('effectiveFrom')}>
          {(p) => <input {...p} type="date" defaultValue={defaultEffectiveFrom} className={inputClass} dir="ltr" />}
        </Field>
      </div>
      <SubmitButton>{t('common.save')}</SubmitButton>
    </form>
  )
}
