'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { buttonStyles } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import { addAddressAction, archiveAddressAction, createCustomerAction, setVipAction, updateAddressAction, updateCustomerAction, type AddressLite } from './actions'

const initial = { ok: false } as ActionState<never>

export interface CustomerDefaults {
  name?: string
  phone?: string
  altPhone?: string | null
  messageLocale?: 'ar' | 'en'
  notes?: string | null
}

function CustomerFields({ fieldError, defaults }: { fieldError: (f: string) => string | undefined; defaults?: CustomerDefaults }) {
  const { t } = useI18n()
  return (
    <>
      <Field label={t('customers.name')} name="name" error={fieldError('name')}>
        {(p) => <input {...p} defaultValue={defaults?.name} className={inputClass} required maxLength={120} dir="auto" />}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('customers.phone')} name="phone" error={fieldError('phone')}>
          {(p) => <input {...p} defaultValue={defaults?.phone} className={inputClass} type="tel" inputMode="tel" required dir="ltr" />}
        </Field>
        <Field label={t('customers.altPhone')} name="altPhone" error={fieldError('altPhone')} optional>
          {(p) => <input {...p} defaultValue={defaults?.altPhone ?? ''} className={inputClass} type="tel" inputMode="tel" dir="ltr" />}
        </Field>
      </div>
      <Field label={t('customers.messageLocale')} name="messageLocale">
        {(p) => (
          <select {...p} defaultValue={defaults?.messageLocale ?? 'ar'} className={inputClass}>
            <option value="ar" lang="ar">العربية</option>
            <option value="en" lang="en">English</option>
          </select>
        )}
      </Field>
      <Field label={t('customers.notes')} name="notes" optional>
        {(p) => <textarea {...p} defaultValue={defaults?.notes ?? ''} className={`${inputClass} min-h-20 py-2`} maxLength={2000} dir="auto" />}
      </Field>
    </>
  )
}

export function NewCustomerForm({ canVip, defaultPhone }: { canVip: boolean; defaultPhone?: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(createCustomerAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStatus state={state} />
      <CustomerFields fieldError={fieldError} defaults={{ phone: defaultPhone }} />
      {canVip && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="isVip" className="h-5 w-5 accent-[var(--color-brand-deep)]" />
          {t('customers.vip')} <span className="text-xs text-muted">— {t('customers.vipHint')}</span>
        </label>
      )}
      <SubmitButton>{t('common.save')}</SubmitButton>
    </form>
  )
}

export function EditCustomerForm({ id, defaults }: { id: string; defaults: CustomerDefaults }) {
  const { t } = useI18n()
  const [state, action] = useActionState(updateCustomerAction.bind(null, id), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStatus state={state} successText={t('common.saved')} />
      <CustomerFields fieldError={fieldError} defaults={defaults} />
      <SubmitButton>{t('common.save')}</SubmitButton>
    </form>
  )
}

export function VipForm({ id, isVip }: { id: string; isVip: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setVipAction.bind(null, id, !isVip), initial)
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t('customers.vipHint')}</p>
      <FormStatus state={state} successText={t('common.saved')} />
      <Field label={t('common.reasonOptional')} name="reason">
        {(p) => <input {...p} className={inputClass} maxLength={500} dir="auto" />}
      </Field>
      <SubmitButton variant={isVip ? 'danger' : 'secondary'}>{isVip ? t('customers.vipOff') : t('customers.vipOn')}</SubmitButton>
    </form>
  )
}

export interface AddressDefaults {
  label?: string | null
  district?: string
  addressLine?: string | null
  buildingDetails?: string | null
  accessInstructions?: string | null
  location?: string | null
}

export function AddressFields({ fieldError, defaults }: { fieldError: (f: string) => string | undefined; defaults?: AddressDefaults }) {
  const { t } = useI18n()
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('customers.addressLabel')} name="label" hint={t('customers.addressLabelHint')} optional>
          {(p) => <input {...p} defaultValue={defaults?.label ?? ''} className={inputClass} maxLength={60} dir="auto" />}
        </Field>
        <Field label={t('customers.district')} name="district" error={fieldError('district')}>
          {(p) => <input {...p} defaultValue={defaults?.district} className={inputClass} required maxLength={120} dir="auto" />}
        </Field>
      </div>
      <Field label={t('customers.addressLine')} name="addressLine" optional>
        {(p) => <input {...p} defaultValue={defaults?.addressLine ?? ''} className={inputClass} maxLength={300} dir="auto" />}
      </Field>
      <Field label={t('customers.building')} name="buildingDetails" optional>
        {(p) => <input {...p} defaultValue={defaults?.buildingDetails ?? ''} className={inputClass} maxLength={300} dir="auto" />}
      </Field>
      <Field label={t('customers.access')} name="accessInstructions" optional>
        {(p) => <textarea {...p} defaultValue={defaults?.accessInstructions ?? ''} className={`${inputClass} min-h-16 py-2`} maxLength={1000} dir="auto" />}
      </Field>
      <Field label={t('customers.location')} name="location" hint={t('customers.locationHint')} error={fieldError('location')} optional>
        {(p) => <input {...p} defaultValue={defaults?.location ?? ''} className={inputClass} dir="ltr" />}
      </Field>
    </>
  )
}

export function AddAddressForm({ customerId, onAdded }: { customerId: string; onAdded?: (a: AddressLite) => void }) {
  const { t } = useI18n()
  const [state, action] = useActionState(async (prev: ActionState<AddressLite>, form: FormData) => {
    const res = await addAddressAction(customerId, prev, form)
    if (res.ok && res.data) onAdded?.(res.data)
    return res
  }, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-4" key={state.ok ? state.at : 'form'}>
      <FormStatus state={state} successText={t('common.saved')} />
      <AddressFields fieldError={fieldError} />
      <SubmitButton variant="secondary">{t('customers.addAddress')}</SubmitButton>
    </form>
  )
}

export function EditAddressForm({ customerId, addressId, defaults }: { customerId: string; addressId: string; defaults: AddressDefaults }) {
  const { t } = useI18n()
  const [state, action] = useActionState(updateAddressAction.bind(null, customerId, addressId), initial)
  const [archiveState, archive] = useActionState(archiveAddressAction.bind(null, customerId, addressId), initial)
  const fieldError = useFieldErrors(state)
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-4">
        <FormStatus state={state} successText={t('common.saved')} />
        <AddressFields fieldError={fieldError} defaults={defaults} />
        <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
      </form>
      <form action={archive}>
        <FormStatus state={archiveState} />
        <button type="submit" className={buttonStyles.ghost}>
          {t('customers.archiveAddress')}
        </button>
      </form>
    </div>
  )
}
