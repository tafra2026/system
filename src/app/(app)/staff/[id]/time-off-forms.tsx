'use client'

import { useActionState } from 'react'
import { Field, FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { buttonStyles } from '@/components/ui'
import { formatCalendarDate } from '@/i18n/format'
import type { ActionState } from '@/server/actions'
import { addDayOffAction, cancelDayOffAction, setWeeklyOffAction } from '../actions'

const initial = { ok: false } as ActionState<never>

export function TimeOffPanel({ employeeId, weekly, dates, today }: { employeeId: string; weekly: number[]; dates: { id: string; date: string; note: string | null }[]; today: string }) {
  const { t, locale } = useI18n()
  const [wState, wAction] = useActionState(setWeeklyOffAction.bind(null, employeeId), initial)
  const [aState, aAction] = useActionState(addDayOffAction.bind(null, employeeId), initial)
  const fieldError = useFieldErrors(aState)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">{t('timeoff.hint')}</p>
      <form action={wAction} className="flex flex-col gap-2">
        <FormStatus state={wState} successText={t('common.saved')} />
        <p className="text-sm font-medium text-ink">{t('timeoff.weekly')}</p>
        <div className="flex flex-wrap gap-2">
          {(['0', '1', '2', '3', '4', '5', '6'] as const).map((d) => (
            <label key={d} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm">
              <input type="checkbox" name="weekly" value={d} defaultChecked={weekly.includes(Number(d))} className="h-4 w-4 accent-[var(--color-brand-deep)]" />
              {t(`settings.weekdays.${d}`)}
            </label>
          ))}
        </div>
        <div>
          <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
        </div>
      </form>
      <form action={aAction} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3" key={aState.ok ? aState.at : 'add'}>
        <div className="sm:col-span-3">
          <FormStatus state={aState} successText={t('common.saved')} />
        </div>
        <Field label={t('timeoff.date')} name="date" error={fieldError('date')}>
          {(p) => <input {...p} type="date" min={today} className={inputClass} dir="ltr" required />}
        </Field>
        <Field label={t('timeoff.note')} name="note" optional>
          {(p) => <input {...p} className={inputClass} dir="auto" maxLength={300} />}
        </Field>
        <SubmitButton>{t('timeoff.addDate')}</SubmitButton>
      </form>
      <div>
        <p className="mb-1 text-sm font-medium text-ink">{t('timeoff.upcoming')}</p>
        {dates.length === 0 ? (
          <p className="text-sm text-muted">{t('timeoff.none')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {dates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {formatCalendarDate(d.date, locale)}
                  {d.note && (
                    <span className="text-xs text-muted" dir="auto">
                      {' '}
                      · {d.note}
                    </span>
                  )}
                </span>
                <CancelButton employeeId={employeeId} id={d.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CancelButton({ employeeId, id }: { employeeId: string; id: string }) {
  const { t } = useI18n()
  const [state, action] = useActionState(cancelDayOffAction.bind(null, employeeId, id), initial)
  return (
    <form action={action}>
      <FormStatus state={state} />
      <button type="submit" className={buttonStyles.ghost}>
        {t('timeoff.cancel')}
      </button>
    </form>
  )
}
