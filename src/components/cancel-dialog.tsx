'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { cancelOrderAction, cancelVisitAction } from '@/app/(app)/orders/actions'
import type { ActionState } from '@/server/actions'
import { FormStatus, inputClass, SubmitButton, useFieldErrors } from './form'
import { useI18n } from './i18n-provider'
import { buttonStyles } from './ui'

const REASONS = ['customer_request', 'unreachable', 'specialist_unavailable', 'location_issue', 'duplicate_or_error', 'operational', 'other'] as const

/**
 * Cancel an order or one remaining visit. A native <dialog> gives focus trapping, Esc to close
 * and correct screen-reader semantics; the reason is required, "other" needs details.
 */
export function CancelDialog({ kind, id }: { kind: 'order' | 'visit'; id: string }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState<(typeof REASONS)[number] | ''>('')
  const action = kind === 'order' ? cancelOrderAction.bind(null, id) : cancelVisitAction.bind(null, id)
  const [state, submit] = useActionState(action, { ok: false } as ActionState)
  const fieldError = useFieldErrors(state)
  useEffect(() => {
    if (state.ok) ref.current?.close()
  }, [state])
  const title = kind === 'order' ? t('cancel.title') : t('cancel.visitTitle')
  return (
    <>
      <button type="button" className={buttonStyles.danger} onClick={() => ref.current?.showModal()}>
        {kind === 'order' ? t('cancel.orderButton') : t('cancel.visitButton')}
      </button>
      <dialog ref={ref} aria-labelledby={`cancel-${id}`} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40">
        <form action={submit} className="flex flex-col gap-3 p-4">
          <h2 id={`cancel-${id}`} className="text-lg font-bold">
            {title}
          </h2>
          <p className="text-sm text-muted">{t('cancel.warning')}</p>
          <FormStatus state={state} />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold">{t('cancel.reason')}</legend>
            {REASONS.map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="reason" value={r} required checked={reason === r} onChange={() => setReason(r)} className="h-5 w-5 accent-[var(--color-brand-deep)]" />
                {t(`cancel.reasons.${r}`)}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('cancel.note')}
            <textarea name="note" rows={3} maxLength={1000} required={reason === 'other'} dir="auto" className={inputClass} />
            {(fieldError('note') || (reason === 'other' && state.fieldErrors?.note)) && <span className="text-danger">{t('cancel.noteRequired')}</span>}
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonStyles.secondary} onClick={() => ref.current?.close()}>
              {t('cancel.close')}
            </button>
            <SubmitButton variant="danger">{t('cancel.confirm')}</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
