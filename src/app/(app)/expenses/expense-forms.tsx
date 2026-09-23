'use client'

import { useActionState, useState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { buttonStyles } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import { approveExpenseAction, createExpenseAction, createRecurringAction, generateDraftsAction, payExpenseAction, voidExpenseAction } from './actions'

const initial = { ok: false } as ActionState<never>
type Cat = { id: string; name: string; code: string }

export function NewExpenseForm({ categories, month, today }: { categories: Cat[]; month: string; today: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(createExpenseAction, initial)
  const [cat, setCat] = useState(categories[0]?.id ?? '')
  const fieldError = useFieldErrors(state)
  const isSupplies = categories.find((c) => c.id === cat)?.code === 'supplies'
  return (
    <form action={action} className="flex flex-col gap-3" key={state.ok ? state.at : 'f'}>
      <FormStatus state={state} successText={t('common.saved')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('expenses.category')} name="categoryId">
          {(p) => (
            <select {...p} value={cat} onChange={(e) => setCat(e.target.value)} className={inputClass}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('expenses.amount')} name="amount" error={fieldError('amountHalalas')}>
          {(p) => <input {...p} className={inputClass} inputMode="decimal" dir="ltr" required />}
        </Field>
        <Field label={t('expenses.period')} name="periodMonth" error={fieldError('periodMonth')}>
          {(p) => <input {...p} type="month" defaultValue={month} className={inputClass} dir="ltr" required />}
        </Field>
      </div>
      <Field label={t('expenses.description')} name="description" error={fieldError('description')}>
        {(p) => <input {...p} className={inputClass} dir="auto" maxLength={300} required />}
      </Field>
      {isSupplies && (
        <Field label={t('expenses.itemName')} name="itemName" optional>
          {(p) => <input {...p} className={inputClass} dir="auto" maxLength={200} />}
        </Field>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('expenses.paidOn')} name="paidOn" hint={t('expenses.paidOnHint')} optional>
          {(p) => <input {...p} type="date" max={today} className={inputClass} dir="ltr" />}
        </Field>
        <Field label={t('expenses.notes')} name="notes" hint={t('expenses.attachmentNote')} optional>
          {(p) => <input {...p} className={inputClass} dir="auto" maxLength={1000} />}
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="approve" className="h-5 w-5 accent-[var(--color-brand-deep)]" />
        {t('expenses.approveNow')}
      </label>
      <SubmitButton>{t('expenses.new')}</SubmitButton>
    </form>
  )
}

export function ExpenseActions({ id, status, paid, today }: { id: string; status: string; paid: boolean; today: string }) {
  const { t } = useI18n()
  const [aState, approve] = useActionState(approveExpenseAction.bind(null, id), initial)
  const [pState, pay] = useActionState(payExpenseAction.bind(null, id), initial)
  const [vState, voidIt] = useActionState(voidExpenseAction.bind(null, id), initial)
  const [voiding, setVoiding] = useState(false)
  if (status === 'voided') return null
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FormStatus state={aState} />
      <FormStatus state={pState} />
      <FormStatus state={vState} />
      {status === 'draft' && (
        <form action={approve}>
          <SubmitButton variant="secondary">{t('expenses.approve')}</SubmitButton>
        </form>
      )}
      {!paid && (
        <form action={pay} className="flex items-end gap-1">
          <input type="date" name="paidOn" defaultValue={today} max={today} className={`${inputClass} max-w-40`} dir="ltr" aria-label={t('expenses.paidOn')} />
          <SubmitButton variant="ghost">{t('expenses.markPaid')}</SubmitButton>
        </form>
      )}
      {!voiding ? (
        <button type="button" className={buttonStyles.ghost} onClick={() => setVoiding(true)}>
          {t('expenses.void')}
        </button>
      ) : (
        <form action={voidIt} className="flex items-end gap-1">
          <input name="reason" className={`${inputClass} max-w-48`} dir="auto" placeholder={t('expenses.voidReason')} aria-label={t('expenses.voidReason')} required />
          <SubmitButton variant="danger">{t('expenses.void')}</SubmitButton>
        </form>
      )}
    </div>
  )
}

export function RecurringForm({ categories }: { categories: Cat[] }) {
  const { t } = useI18n()
  const [state, action] = useActionState(createRecurringAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4" key={state.ok ? state.at : 'r'}>
      <div className="sm:col-span-4">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
      <Field label={t('expenses.category')} name="categoryId">
        {(p) => (
          <select {...p} className={inputClass}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('expenses.amount')} name="amount" error={fieldError('amountHalalas')}>
        {(p) => <input {...p} className={inputClass} inputMode="decimal" dir="ltr" required />}
      </Field>
      <Field label={t('expenses.description')} name="description">
        {(p) => <input {...p} className={inputClass} dir="auto" required />}
      </Field>
      <SubmitButton variant="secondary">{t('expenses.addRecurring')}</SubmitButton>
    </form>
  )
}

export function GenerateDraftsButton({ month }: { month: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(generateDraftsAction.bind(null, month), initial as ActionState<number>)
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <SubmitButton variant="secondary">{t('expenses.generate')}</SubmitButton>
      {state.ok && <span className="text-sm text-success">{t('expenses.generated', { count: state.data ?? 0 })}</span>}
      <FormStatus state={state} />
    </form>
  )
}
