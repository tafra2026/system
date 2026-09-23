'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import type { ActionState } from '@/server/actions'
import { createTeamAction, membershipAction } from './actions'

const initial = { ok: false } as ActionState<never>

export function NewTeamForm() {
  const { t } = useI18n()
  const [state, action] = useActionState(createTeamAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" key={state.ok ? state.at : 'f'}>
      <div className="min-w-48 flex-1">
        <Field label={t('teams.name')} name="name" error={fieldError('name')}>
          {(p) => <input {...p} className={inputClass} dir="auto" maxLength={80} required />}
        </Field>
      </div>
      <SubmitButton>{t('teams.create')}</SubmitButton>
      <div className="w-full">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
    </form>
  )
}

export function MembershipForm({ employees, teams, today }: { employees: { id: string; label: string }[]; teams: { id: string; name: string }[]; today: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(membershipAction, initial)
  const fieldError = useFieldErrors(state)
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4">
      <div className="sm:col-span-4">
        <FormStatus state={state} successText={t('common.saved')} />
      </div>
      <Field label={t('teams.employee')} name="employeeId" error={fieldError('employeeId')}>
        {(p) => (
          <select {...p} className={inputClass} required>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('teams.team')} name="teamId" error={fieldError('teamId')}>
        {(p) => (
          <select {...p} className={inputClass}>
            <option value="">{t('teams.noTeam')}</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('teams.from')} name="from" error={fieldError('effectiveFrom')}>
        {(p) => <input {...p} type="date" min={today} defaultValue={today} className={inputClass} dir="ltr" required />}
      </Field>
      <SubmitButton>{t('teams.move')}</SubmitButton>
    </form>
  )
}
