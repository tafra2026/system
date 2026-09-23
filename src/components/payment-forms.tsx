'use client'

import { useActionState, useState } from 'react'
import { recordPaymentAction, decideTransferAction } from '@/app/(app)/payments/actions'
import type { ActionState } from '@/server/actions'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from './form'
import { useI18n } from './i18n-provider'
import { buttonStyles } from './ui'

const initial = { ok: false } as ActionState<never>
export type PayMethod = 'cash' | 'bank_transfer' | 'pos' | 'tabby' | 'tamara'

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

/** Record a payment. A fresh idempotency key per submission makes a double tap harmless. */
export function RecordPaymentForm({ orderId, path, methods, remainingSar, compact }: { orderId: string; path: string; methods: PayMethod[]; remainingSar: string; compact?: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(!compact)
  const [key, setKey] = useState(newKey)
  const [method, setMethod] = useState<PayMethod>(methods[0]!)
  const [state, action] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await recordPaymentAction(orderId, path, prev, form)
    if (r.ok) setKey(newKey())
    return r
  }, initial)
  const fieldError = useFieldErrors(state)
  if (!methods.length) return null
  if (!open)
    return (
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {t('payments.record')}
      </button>
    )
  const needsRef = method !== 'cash'
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-line p-3" key={`${key}-${remainingSar}`}>
      <input type="hidden" name="idempotencyKey" value={key} />
      <FormStatus state={state} successText={t('payments.recorded')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('payments.method')} name="method">
          {(p) => (
            <select {...p} value={method} onChange={(e) => setMethod(e.target.value as PayMethod)} className={inputClass}>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {t(`payments.methods.${m}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('payments.amount')} name="amount" error={fieldError('amountHalalas')}>
          {(p) => <input {...p} defaultValue={remainingSar} className={inputClass} inputMode="decimal" dir="ltr" required />}
        </Field>
      </div>
      {needsRef && (
        <Field label={t('payments.reference')} name="reference" hint={t('payments.referenceHint')} error={fieldError('reference')}>
          {(p) => <input {...p} className={inputClass} dir="ltr" maxLength={200} required={method !== 'bank_transfer'} />}
        </Field>
      )}
      {(method === 'tabby' || method === 'tamara') && <p className="text-xs text-muted">{t('payments.providerManualNote')}</p>}
      {!compact && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('wizard.visitDate')} name="date" hint={t('payments.receivedAt')} optional>
            {(p) => <input {...p} type="date" className={inputClass} dir="ltr" />}
          </Field>
          <Field label={t('wizard.visitTime')} name="time" optional>
            {(p) => <input {...p} type="time" className={inputClass} dir="ltr" />}
          </Field>
        </div>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="isDeposit" className="h-5 w-5 accent-[var(--color-brand-deep)]" />
        {t('payments.deposit')}
      </label>
      <SubmitButton>{t('payments.record')}</SubmitButton>
    </form>
  )
}

export function DecideTransferButtons({ paymentId, path }: { paymentId: string; path: string }) {
  const { t } = useI18n()
  const [approveState, approve] = useActionState(decideTransferAction.bind(null, paymentId, true, path), initial)
  const [rejectState, reject] = useActionState(decideTransferAction.bind(null, paymentId, false, path), initial)
  const [rejecting, setRejecting] = useState(false)
  const fieldError = useFieldErrors(rejectState)
  return (
    <div className="flex flex-col gap-2">
      <FormStatus state={approveState} />
      <FormStatus state={rejectState} />
      <div className="flex flex-wrap gap-2">
        <form action={approve}>
          <SubmitButton>{t('payments.approve')}</SubmitButton>
        </form>
        {!rejecting && (
          <button type="button" className={buttonStyles.danger} onClick={() => setRejecting(true)}>
            {t('payments.reject')}
          </button>
        )}
      </div>
      {rejecting && (
        <form action={reject} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label={t('payments.rejectReason')} name="reason" error={fieldError('reason')}>
              {(p) => <input {...p} className={inputClass} dir="auto" required />}
            </Field>
          </div>
          <SubmitButton variant="danger">{t('payments.reject')}</SubmitButton>
        </form>
      )}
    </div>
  )
}
