'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import type { ActionState } from '@/server/actions'
import { adjustmentAction, advanceAction, approveRunAction, closeRunAction, payItemAction, prepareRunAction } from './actions'

const initial = { ok: false } as ActionState<never>
type Emp = { id: string; name: string }

export function RunButton({ kind, month, variant = 'secondary' }: { kind: 'prepare' | 'approve' | 'close'; month: string; variant?: 'primary' | 'secondary' }) {
  const { t } = useI18n()
  const fn = kind === 'prepare' ? prepareRunAction : kind === 'approve' ? approveRunAction : closeRunAction
  const [state, action] = useActionState(fn.bind(null, month), initial)
  return (
    <form action={action} className="flex flex-col gap-1">
      <FormStatus state={state} />
      <SubmitButton variant={variant}>{t(kind === 'prepare' ? 'payroll.prepare' : kind === 'approve' ? 'payroll.approve' : 'payroll.close')}</SubmitButton>
    </form>
  )
}

export function PayItemForm({ itemId, remainingSar, today }: { itemId: string; remainingSar: string; today: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(payItemAction.bind(null, itemId), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <FormStatus state={state} />
      <input name="amount" defaultValue={remainingSar} className={`${inputClass} max-w-28`} inputMode="decimal" dir="ltr" aria-label={t('payroll.payAmount')} aria-invalid={fieldError('amountHalalas') ? true : undefined} />
      <input type="date" name="paidOn" defaultValue={today} max={today} className={`${inputClass} max-w-40`} dir="ltr" aria-label={t('payroll.paidOn')} />
      <select name="method" className={`${inputClass} max-w-36`} aria-label={t('payroll.payMethod')}>
        <option value="bank_transfer">{t('payments.methods.bank_transfer')}</option>
        <option value="cash">{t('payments.methods.cash')}</option>
      </select>
      <SubmitButton variant="secondary">{t('payroll.pay')}</SubmitButton>
      {fieldError('amountHalalas') && <span className="text-xs text-danger">{fieldError('amountHalalas')}</span>}
    </form>
  )
}

export function AdjustmentForm({ month, employees }: { month: string; employees: Emp[] }) {
  const { t } = useI18n()
  const [state, action] = useActionState(adjustmentAction.bind(null, month), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-5" key={state.ok ? state.at : 'a'}>
      <div className="sm:col-span-5">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
      <Field label={t('payroll.employee')} name="employeeId">
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
      <Field label={t('payroll.kind')} name="kind">
        {(p) => (
          <select {...p} className={inputClass}>
            <option value="bonus">{t('payroll.bonus')}</option>
            <option value="deduction">{t('payroll.deduction')}</option>
          </select>
        )}
      </Field>
      <Field label={t('payroll.payAmount')} name="amount" error={fieldError('amountHalalas')}>
        {(p) => <input {...p} className={inputClass} inputMode="decimal" dir="ltr" required />}
      </Field>
      <Field label={t('payroll.reason')} name="reason" error={fieldError('reason')}>
        {(p) => <input {...p} className={inputClass} dir="auto" required />}
      </Field>
      <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
    </form>
  )
}

export function AdvanceForm({ employees, today }: { employees: Emp[]; today: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(advanceAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3" key={state.ok ? state.at : 'v'}>
      <div className="sm:col-span-3">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
      <Field label={t('payroll.employee')} name="employeeId">
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
      <Field label={t('payroll.advanceAmount')} name="amount" error={fieldError('amountHalalas')}>
        {(p) => <input {...p} className={inputClass} inputMode="decimal" dir="ltr" required />}
      </Field>
      <Field label={t('payroll.installment')} name="installment" error={fieldError('monthlyInstallmentHalalas')}>
        {(p) => <input {...p} className={inputClass} inputMode="decimal" dir="ltr" required />}
      </Field>
      <Field label={t('payroll.givenOn')} name="givenOn">
        {(p) => <input {...p} type="date" defaultValue={today} max={today} className={inputClass} dir="ltr" required />}
      </Field>
      <Field label={t('payroll.reason')} name="reason" optional>
        {(p) => <input {...p} className={inputClass} dir="auto" />}
      </Field>
      <SubmitButton variant="secondary">{t('payroll.newAdvance')}</SubmitButton>
    </form>
  )
}
