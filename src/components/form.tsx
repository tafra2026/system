'use client'

import { useEffect, useId, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { translateError } from '@/i18n'
import type { MessageKey } from '@/i18n/types'
import { buttonStyles } from './ui'
import { useI18n } from './i18n-provider'
import { useOnline } from './online-status'

interface ActionStateLike {
  ok: boolean
  error?: string
  errorParams?: Record<string, string | number>
  fieldErrors?: Record<string, string>
}

export function Field({
  label,
  name,
  hint,
  error,
  optional,
  children,
}: {
  label: string
  name: string
  hint?: string
  error?: string
  optional?: boolean
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; name: string }) => React.ReactNode
}) {
  const { t } = useI18n()
  const id = useId()
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="ms-1 text-xs font-normal text-muted">({t('common.optional')})</span>}
      </label>
      {children({ id, name, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export { inputClass } from './form-styles'

export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  className = '',
  name,
  value,
}: {
  children: React.ReactNode
  pendingLabel?: string
  variant?: keyof typeof buttonStyles
  className?: string
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()
  const online = useOnline()
  const { t } = useI18n()
  return (
    <button type="submit" name={name} value={value} disabled={pending || !online} aria-busy={pending} className={`${buttonStyles[variant]} ${className}`}>
      {pending ? (pendingLabel ?? t('common.saving')) : children}
    </button>
  )
}

/** Translate field error codes from an action result. */
export function useFieldErrors(state: ActionStateLike) {
  const { t } = useI18n()
  return (field: string) => {
    const code = state.fieldErrors?.[field]
    return code ? t(`errors.${code}` as MessageKey) : undefined
  }
}

/** Success/error banner for an action result; re-announces on each submission. */
export function FormStatus({ state, successText }: { state: ActionStateLike & { at?: number }; successText?: string }) {
  const { t } = useI18n()
  const [visible, setVisible] = useState(true)
  useEffect(() => setVisible(true), [state.at])
  if (!visible || state.at === undefined) return null
  if (state.ok) {
    return successText ? (
      <p role="status" className="rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
        {successText}
      </p>
    ) : null
  }
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {translateError(t, state.error, state.errorParams)}
    </p>
  )
}
