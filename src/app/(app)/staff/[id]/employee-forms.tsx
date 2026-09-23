'use client'

import { useActionState } from 'react'
import { CopyButton } from '@/components/copy-button'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { Alert } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import {
  addSalaryAction,
  changeRoleAction,
  createAccountAction,
  createAccountWithPasswordAction,
  reissueInviteAction,
  setPasswordAction,
  setAccountSuspendedAction,
  setStatusAction,
  updateDetailsAction,
  type InviteResult,
} from '../actions'
import { EmployeeFields, ROLES } from '../employee-fields'

const initial = { ok: false } as ActionState<never>

export function DetailsForm({ employeeId, defaults }: { employeeId: string; defaults: { fullName: string; displayNameEn: string | null; phone: string | null; notes: string | null } }) {
  const { t } = useI18n()
  const [state, action] = useActionState(updateDetailsAction.bind(null, employeeId), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStatus state={state} successText={t('common.saved')} />
      <EmployeeFields fieldError={fieldError} defaults={defaults} />
      <SubmitButton>{t('common.save')}</SubmitButton>
    </form>
  )
}

export function RoleForm({ employeeId, role }: { employeeId: string; role: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(changeRoleAction.bind(null, employeeId), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormStatus state={state} successText={t('common.saved')} />
      <Field label={t('staff.role')} name="role" error={fieldError('role')}>
        {(p) => (
          <select {...p} defaultValue={role} className={inputClass}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('common.reasonOptional')} name="reason">
        {(p) => <input {...p} className={inputClass} maxLength={500} dir="auto" />}
      </Field>
      <SubmitButton variant="secondary">{t('staff.changeRole')}</SubmitButton>
    </form>
  )
}

export function StatusForm({ employeeId, status }: { employeeId: string; status: 'active' | 'inactive' | 'archived' }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setStatusAction.bind(null, employeeId), initial)
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t('staff.statusHint')}</p>
      <FormStatus state={state} successText={t('common.saved')} />
      <Field label={t('common.reasonOptional')} name="reason">
        {(p) => <input {...p} className={inputClass} maxLength={500} dir="auto" />}
      </Field>
      <div className="flex flex-wrap gap-2">
        {status !== 'active' && (
          <SubmitButton variant="secondary" name="status" value="active">
            {t('staff.activate')}
          </SubmitButton>
        )}
        {status === 'active' && (
          <SubmitButton variant="danger" name="status" value="inactive">
            {t('staff.deactivate')}
          </SubmitButton>
        )}
        {status === 'inactive' && (
          <SubmitButton variant="ghost" name="status" value="archived">
            {t('staff.archive')}
          </SubmitButton>
        )}
      </div>
    </form>
  )
}

export function SalaryForm({ employeeId, defaultEffectiveFrom, defaultAmount }: { employeeId: string; defaultEffectiveFrom: string; defaultAmount: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(addSalaryAction.bind(null, employeeId), initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{t('staff.addSalary')}</h3>
      <FormStatus state={state} successText={t('common.saved')} />
      <Field label={t('staff.amount')} name="salary" error={fieldError('salary') ?? fieldError('amount')}>
        {(p) => <input {...p} defaultValue={defaultAmount} className={inputClass} inputMode="decimal" dir="ltr" required />}
      </Field>
      <Field label={t('staff.effectiveFrom')} name="effectiveFrom" hint={t('staff.effectiveFromHint')} error={fieldError('effectiveFrom')}>
        {(p) => <input {...p} type="date" defaultValue={defaultEffectiveFrom} min={defaultEffectiveFrom} className={inputClass} dir="ltr" required />}
      </Field>
      <Field label={t('common.reasonOptional')} name="reason">
        {(p) => <input {...p} className={inputClass} maxLength={500} dir="auto" />}
      </Field>
      <SubmitButton>{t('common.save')}</SubmitButton>
    </form>
  )
}

function InviteLink({ result }: { result: InviteResult }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-brand/40 bg-brand-soft p-3">
      <p className="text-sm font-semibold text-ink">{t('staff.setupLinkTitle')}</p>
      <p className="text-xs text-muted">{t('staff.setupLinkBody', { hours: result.hours })}</p>
      <code className="ltr-data block break-all rounded-lg bg-surface p-2 text-xs text-ink">{result.url}</code>
      <div>
        <CopyButton value={result.url} />
      </div>
    </div>
  )
}

function PasswordFields({ fieldError }: { fieldError: (name: string) => string | undefined }) {
  const { t } = useI18n()
  return (
    <>
      <Field label={t('staff.password')} name="password" hint={t('auth.passwordRule')} error={fieldError('password')}>
        {(p) => <input {...p} type="password" autoComplete="new-password" className={`${inputClass} ltr-data`} dir="ltr" minLength={10} maxLength={200} required />}
      </Field>
      <Field label={t('auth.confirmPassword')} name="confirm" error={fieldError('confirm')}>
        {(p) => <input {...p} type="password" autoComplete="new-password" className={`${inputClass} ltr-data`} dir="ltr" minLength={10} maxLength={200} required />}
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="requireChange" defaultChecked className="h-5 w-5 accent-[var(--color-brand-deep)]" />
        {t('staff.requireChange')}
      </label>
    </>
  )
}

export function AccountPanel({
  employeeId,
  account,
  canCreate,
}: {
  employeeId: string
  account: { id: string; status: 'pending' | 'active' | 'suspended' } | null
  canCreate: boolean
}) {
  const { t } = useI18n()
  const [createState, createAction] = useActionState(createAccountAction.bind(null, employeeId), initial)
  const [createPwState, createPwAction] = useActionState(createAccountWithPasswordAction.bind(null, employeeId), initial)
  const [setPwState, setPw] = useActionState(setPasswordAction.bind(null, employeeId, account?.id ?? ''), initial)
  const [reissueState, reissue] = useActionState(reissueInviteAction.bind(null, employeeId, account?.id ?? ''), initial)
  const [suspendState, suspend] = useActionState(setAccountSuspendedAction.bind(null, employeeId, account?.id ?? '', account?.status !== 'suspended'), initial)
  const fieldError = useFieldErrors(createState)
  const pwFieldError = useFieldErrors(createPwState)
  const setPwFieldError = useFieldErrors(setPwState)

  if (!account) {
    if (createState.ok && createState.data) return <InviteLink result={createState.data} />
    if (!canCreate) return <Alert tone="warning">{t('errors.employee_not_active')}</Alert>
    return (
      <div className="flex flex-col gap-4">
        <form action={createPwAction} className="flex flex-col gap-3">
          <FormStatus state={createPwState} />
          <Field label={t('staff.username')} name="username" hint={t('staff.usernameHint')} error={pwFieldError('username')}>
            {(p) => <input {...p} className={`${inputClass} ltr-data`} dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} required pattern="[a-zA-Z0-9._\-]{3,32}" />}
          </Field>
          <PasswordFields fieldError={pwFieldError} />
          <p className="text-xs text-muted">{t('staff.passwordPrivateHint')}</p>
          <SubmitButton>{t('staff.createWithPassword')}</SubmitButton>
        </form>
        <details className="rounded-xl border border-line p-3">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-ink">{t('staff.orSetupLink')}</summary>
          <form action={createAction} className="mt-3 flex flex-col gap-3">
            <FormStatus state={createState} />
            <Field label={t('staff.username')} name="username" hint={t('staff.usernameHint')} error={fieldError('username')}>
              {(p) => <input {...p} className={`${inputClass} ltr-data`} dir="ltr" autoCapitalize="none" spellCheck={false} required pattern="[a-zA-Z0-9._\-]{3,32}" />}
            </Field>
            <SubmitButton variant="secondary">{t('staff.createAccount')}</SubmitButton>
          </form>
        </details>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {/* After creation the page re-renders with the new account; keep showing the one-time link. */}
      {reissueState.ok && reissueState.data ? (
        <InviteLink result={reissueState.data} />
      ) : (
        createState.ok && createState.data && <InviteLink result={createState.data} />
      )}
      {createPwState.ok && <Alert tone="success">{t('staff.accountCreated')}</Alert>}
      <FormStatus state={reissueState} />
      <FormStatus state={suspendState} successText={t('common.saved')} />
      <details className="rounded-xl border border-line p-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-ink">{t('staff.setPassword')}</summary>
        <form action={setPw} className="mt-3 flex flex-col gap-3">
          <FormStatus state={setPwState} successText={t('staff.passwordSet')} />
          <PasswordFields fieldError={setPwFieldError} />
          <p className="text-xs text-muted">{t('staff.setPasswordHint')}</p>
          <SubmitButton>{t('staff.setPassword')}</SubmitButton>
        </form>
      </details>
      <div className="flex flex-wrap gap-2">
        <form action={reissue}>
          <SubmitButton variant="secondary">{t('staff.reissueLink')}</SubmitButton>
        </form>
        <form action={suspend}>
          <SubmitButton variant={account.status === 'suspended' ? 'secondary' : 'danger'}>
            {account.status === 'suspended' ? t('staff.reactivateAccount') : t('staff.suspendAccount')}
          </SubmitButton>
        </form>
      </div>
      <p className="text-xs text-muted">{t('staff.reissueHint')}</p>
    </div>
  )
}
