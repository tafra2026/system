'use client'

import { useActionState, useEffect, useState } from 'react'
import { CopyButton } from '@/components/copy-button'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { Alert, buttonStyles } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import type { CreatedLink, ProviderState } from '@/server/services/payment-links'
import { allocateLinkAction, cancelLinkAction, createLinkAction, linkWhatsappAction, settleLinkAction } from './actions'

export interface LinkDefaults {
  orderId: string
  reference: string
  customerName: string
  phone: string
  suggestedSar: string
}

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function WhatsappLinkButton({ linkId }: { linkId: string }) {
  const { t } = useI18n()
  const [err, setErr] = useState(false)
  return (
    <>
      <button
        type="button"
        className={buttonStyles.primary}
        onClick={async () => {
          // Open the tab first (popup blockers), then point it at WhatsApp.
          const win = window.open('', '_blank', 'noopener')
          const r = await linkWhatsappAction(linkId)
          if (r.ok && r.data) {
            if (win) win.location.href = r.data.link
            else window.location.href = r.data.link
          } else {
            win?.close()
            setErr(true)
          }
        }}
      >
        {t('paymentLinks.whatsapp')}
      </button>
      {err && <span className="text-sm text-danger">{t('errors.link_not_open')}</span>}
    </>
  )
}

export function NewLinkForm({ providers, defaults }: { providers: ProviderState[]; defaults: LinkDefaults | null }) {
  const { t } = useI18n()
  const [state, action] = useActionState(createLinkAction, { ok: false } as ActionState<CreatedLink>)
  const [key, setKey] = useState('')
  useEffect(() => setKey(newKey()), [state.data?.id])
  const fieldError = useFieldErrors(state)
  const firstReady = providers.find((p) => p.configured)?.provider ?? 'paymob'
  const [provider, setProvider] = useState(firstReady)
  const current = providers.find((p) => p.provider === provider)
  const created = state.ok ? state.data : undefined
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={key} />
      {defaults && <input type="hidden" name="orderId" value={defaults.orderId} />}
      <FormStatus state={state} />
      {created?.status === 'open' && created.checkoutUrl && (
        <div className="flex flex-col gap-2 rounded-xl border border-success/40 bg-success-soft p-3">
          <p className="text-sm font-semibold text-success">{t('paymentLinks.created')}</p>
          <code className="ltr-data block break-all rounded-lg bg-surface p-2 text-xs">{created.checkoutUrl}</code>
          <div className="flex flex-wrap gap-2">
            <WhatsappLinkButton linkId={created.id} />
            <CopyButton value={created.checkoutUrl} label={t('paymentLinks.copy')} />
          </div>
        </div>
      )}
      {created?.status === 'creating' && <Alert tone="warning">{t('paymentLinks.creatingUnknown')}</Alert>}
      {created?.status === 'failed' && <Alert tone="error">{t('paymentLinks.failed')}</Alert>}

      <Field label={t('paymentLinks.phone')} name="phone" error={fieldError('phone')}>
        {(p) => <input {...p} defaultValue={defaults?.phone ?? ''} className={`${inputClass} ltr-data`} dir="ltr" inputMode="tel" autoComplete="off" required placeholder="05xxxxxxxx" />}
      </Field>
      <Field label={t('paymentLinks.name')} name="customerName">
        {(p) => <input {...p} defaultValue={defaults?.customerName ?? ''} className={inputClass} dir="auto" maxLength={120} />}
      </Field>
      {defaults ? (
        <p className="text-sm text-ink">
          {t('paymentLinks.order')}: <span className="ltr-data font-semibold">{defaults.reference}</span>
        </p>
      ) : (
        <Field label={t('paymentLinks.order')} name="orderReference" hint={t('paymentLinks.orderHint')} error={fieldError('orderReference')}>
          {(p) => <input {...p} className={`${inputClass} ltr-data`} dir="ltr" autoCapitalize="characters" placeholder="PM-2609-0001" />}
        </Field>
      )}
      <Field label={t('paymentLinks.amount')} name="amount" hint={defaults ? t('paymentLinks.amountHint') : undefined} error={fieldError('amountHalalas')}>
        {(p) => <input {...p} defaultValue={defaults?.suggestedSar ?? ''} className={`${inputClass} ltr-data`} dir="ltr" inputMode="decimal" required />}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-ink">{t('paymentLinks.provider')}</legend>
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => (
            <label key={p.provider} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm ${provider === p.provider ? 'border-brand-deep bg-brand-soft' : 'border-line'} ${p.configured ? '' : 'opacity-70'}`}>
              <input type="radio" name="provider" value={p.provider} checked={provider === p.provider} onChange={() => setProvider(p.provider)} className="h-5 w-5 accent-[var(--color-brand-deep)]" />
              <span>
                {t(`paymentLinks.providers.${p.provider}`)}
                {!p.configured && <span className="block text-xs text-muted">{p.missing === 'integration_pending' ? t('paymentLinks.integrationPending') : t('paymentLinks.notConfigured')}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {current?.configured && current.methods.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-ink">{t('paymentLinks.methods')}</legend>
          <div className="flex flex-wrap gap-3">
            {current.methods.map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="methods" value={m} defaultChecked className="h-5 w-5 accent-[var(--color-brand-deep)]" />
                {t(`paymentLinks.methodNames.${m as 'card'}`)}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">{t('paymentLinks.methodsNote')}</p>
        </fieldset>
      )}
      <Field label={t('paymentLinks.description')} name="description">
        {(p) => <input {...p} className={inputClass} dir="auto" maxLength={250} />}
      </Field>
      <SubmitButton>{t('paymentLinks.create')}</SubmitButton>
    </form>
  )
}

export function CancelLinkButton({ linkId }: { linkId: string }) {
  const { t } = useI18n()
  const [state, setState] = useState<ActionState | null>(null)
  return (
    <>
      <button type="button" className={buttonStyles.ghost} onClick={async () => setState(await cancelLinkAction(linkId))}>
        {t('paymentLinks.cancelLink')}
      </button>
      {state && <FormStatus state={state} />}
    </>
  )
}

export function SettlementForms({ linkId }: { linkId: string }) {
  const { t } = useI18n()
  const [aState, allocate] = useActionState(allocateLinkAction.bind(null, linkId), { ok: false } as ActionState)
  const [sState, settle] = useActionState(settleLinkAction.bind(null, linkId), { ok: false } as ActionState)
  const aErr = useFieldErrors(aState)
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <form action={allocate} className="flex flex-col gap-2">
        <FormStatus state={aState} successText={t('common.saved')} />
        <Field label={t('paymentLinks.allocateOrder')} name="orderReference" error={aErr('orderReference')}>
          {(p) => <input {...p} className={`${inputClass} ltr-data`} dir="ltr" required placeholder="PM-2609-0001" />}
        </Field>
        <SubmitButton variant="secondary">{t('paymentLinks.allocate')}</SubmitButton>
      </form>
      <form action={settle} className="flex flex-col gap-2">
        <FormStatus state={sState} successText={t('common.saved')} />
        <Field label={t('paymentLinks.settleNote')} name="note">
          {(p) => <input {...p} className={inputClass} dir="auto" required maxLength={500} />}
        </Field>
        <SubmitButton variant="secondary">{t('paymentLinks.settle')}</SubmitButton>
      </form>
    </div>
  )
}
