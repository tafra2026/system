'use client'

import { useActionState, useState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { buttonStyles } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import { adjustPriceAction, assignItemAction, completeVisitAction, deliveryFeeAction, moderatorAction, notesAction, pendingReviewAction, rescheduleVisitAction } from '../actions'

const initial = { ok: false } as ActionState<never>

export function RescheduleForm({
  orderId,
  visitId,
  defaults,
  specialists,
  label,
}: {
  orderId: string
  visitId: string
  defaults: { date: string; time: string; durationMinutes: number; specialistIds: string[] }
  specialists: { id: string; name: string }[]
  label: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [state, action] = useActionState(rescheduleVisitAction.bind(null, orderId, visitId), initial)
  const fieldError = useFieldErrors(state)
  if (!open) {
    return (
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }
  return (
    <form action={action} className="flex w-full flex-col gap-3 rounded-xl border border-line p-3">
      <FormStatus state={state} successText={t('common.saved')} />
      <p className="text-xs text-muted">{t('wizard.visitTimeHint')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('wizard.visitDate')} name="date" error={fieldError('date')}>
          {(p) => <input {...p} type="date" defaultValue={defaults.date} className={inputClass} dir="ltr" required />}
        </Field>
        <Field label={t('wizard.visitTime')} name="time" error={fieldError('time')}>
          {(p) => <input {...p} type="time" defaultValue={defaults.time} className={inputClass} dir="ltr" required />}
        </Field>
        <Field label={t('wizard.visitDuration')} name="durationMinutes" error={fieldError('durationMinutes')}>
          {(p) => <input {...p} type="number" min={5} max={720} defaultValue={defaults.durationMinutes} className={inputClass} dir="ltr" required />}
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-ink">{t('wizard.chooseSpecialists')}</legend>
        {fieldError('specialistIds') && <p className="text-xs text-danger">{fieldError('specialistIds')}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {specialists.map((s) => (
            <label key={s.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm">
              <input type="checkbox" name="specialistIds" value={s.id} defaultChecked={defaults.specialistIds.includes(s.id)} className="h-4 w-4 accent-[var(--color-brand-deep)]" />
              <span dir="auto">{s.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t('common.reasonOptional')} name="reason">
        {(p) => <input {...p} className={inputClass} dir="auto" maxLength={500} />}
      </Field>
      <div className="flex gap-2">
        <SubmitButton>{t('common.save')}</SubmitButton>
        <button type="button" className={buttonStyles.ghost} onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

export function CompleteVisitButton({ path, visitId, label }: { path: string; visitId: string; label?: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(completeVisitAction.bind(null, path, visitId), initial)
  return (
    <form action={action}>
      <FormStatus state={state} />
      <SubmitButton>{label ?? t('orders.complete')}</SubmitButton>
    </form>
  )
}

export function PendingReviewForm({ orderId, visitId }: { orderId: string; visitId: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [state, action] = useActionState(pendingReviewAction.bind(null, orderId, visitId), initial)
  const fieldError = useFieldErrors(state)
  if (!open)
    return (
      <button type="button" className={buttonStyles.ghost} onClick={() => setOpen(true)}>
        {t('orders.markPending')}
      </button>
    )
  return (
    <form action={action} className="flex w-full flex-col gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3">
      <p className="text-xs text-warning">{t('orders.pendingHint')}</p>
      <FormStatus state={state} />
      <Field label={t('orders.pendingReason')} name="reason" error={fieldError('reason')}>
        {(p) => <input {...p} className={inputClass} dir="auto" required maxLength={500} />}
      </Field>
      <SubmitButton variant="danger">{t('orders.markPending')}</SubmitButton>
    </form>
  )
}

export function AdjustPriceForm({ orderId, lineId, current }: { orderId: string; lineId: string; current: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [state, action] = useActionState(adjustPriceAction.bind(null, orderId, lineId), initial)
  const fieldError = useFieldErrors(state)
  if (!open)
    return (
      <button type="button" className="text-xs font-medium text-brand-deep underline" onClick={() => setOpen(true)}>
        {t('orders.adjustPrice')}
      </button>
    )
  return (
    <form action={action} className="mt-2 flex flex-col gap-2 rounded-xl border border-line p-3">
      <FormStatus state={state} successText={t('common.saved')} />
      <Field label={t('orders.newFinalPrice')} name="price" hint={t('orders.newFinalPriceHint')} error={fieldError('price')}>
        {(p) => <input {...p} defaultValue={current} className={inputClass} inputMode="decimal" dir="ltr" />}
      </Field>
      <Field label={t('wizard.manualReason')} name="reason">
        {(p) => <input {...p} className={inputClass} dir="auto" maxLength={500} />}
      </Field>
      <SubmitButton>{t('common.save')}</SubmitButton>
    </form>
  )
}

export function DeliveryFeeForm({ orderId, current }: { orderId: string; current: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(deliveryFeeAction.bind(null, orderId), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="min-w-40 flex-1">
        <Field label={t('wizard.deliveryFee')} name="fee" error={fieldError('deliveryFeeHalalas')}>
          {(p) => <input {...p} defaultValue={current} className={inputClass} inputMode="decimal" dir="ltr" />}
        </Field>
      </div>
      <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
      <div className="w-full">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
    </form>
  )
}

export function ModeratorForm({ orderId, current, moderators }: { orderId: string; current: string | null; moderators: { id: string; name: string }[] }) {
  const { t } = useI18n()
  const [state, action] = useActionState(moderatorAction.bind(null, orderId), initial)
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormStatus state={state} successText={t('common.saved')} />
      <Field label={t('orders.moderator')} name="moderator">
        {(p) => (
          <select {...p} defaultValue={current ?? ''} className={inputClass}>
            <option value="">{t('orders.noModerator')}</option>
            {moderators.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('common.reasonOptional')} name="reason">
        {(p) => <input {...p} className={inputClass} dir="auto" maxLength={500} />}
      </Field>
      <SubmitButton variant="secondary">{t('orders.changeModerator')}</SubmitButton>
    </form>
  )
}

export function NotesForm({ orderId, current }: { orderId: string; current: string | null }) {
  const { t } = useI18n()
  const [state, action] = useActionState(notesAction.bind(null, orderId), initial)
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormStatus state={state} successText={t('common.saved')} />
      <textarea name="notes" defaultValue={current ?? ''} className={`${inputClass} min-h-20 py-2`} dir="auto" maxLength={2000} aria-label={t('orders.notes')} />
      <SubmitButton variant="secondary">{t('orders.saveNotes')}</SubmitButton>
    </form>
  )
}

export function AssignItemForm({ orderId, itemId, current, specialists }: { orderId: string; itemId: string; current: string | null; specialists: { id: string; name: string }[] }) {
  const { t } = useI18n()
  const [state, action] = useActionState(assignItemAction.bind(null, orderId, itemId), initial)
  return (
    <form action={action} className="flex items-center gap-1">
      <select name="specialist" defaultValue={current ?? ''} className={`${inputClass} min-h-9 max-w-40 py-0 text-sm`} aria-label={t('wizard.assignTo')} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="">{t('wizard.unassigned')}</option>
        {specialists.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {!state.ok && state.error && <span className="text-xs text-danger">!</span>}
    </form>
  )
}
