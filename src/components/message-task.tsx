'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmSentAction, dismissAction, markOpenedAction, prepareMessageAction } from '@/app/(app)/messages/actions'
import { translateError } from '@/i18n'
import type { ActionState } from '@/server/actions'
import type { PreparedMessage } from '@/server/services/messages'
import { CopyButton } from './copy-button'
import { useI18n } from './i18n-provider'
import { useOnline } from './online-status'
import { buttonStyles } from './ui'

type Status = 'ready' | 'opened' | 'sent' | 'cancelled'

/**
 * Prepare → open the customer's chat in WhatsApp → staff presses send there → confirms here.
 * Opening the chat is recorded as "opened" only; nothing is sent by the app.
 */
export function MessageTaskActions({ taskId, status, canDismiss }: { taskId: string; status: Status; canDismiss: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const online = useOnline()
  const [pending, start] = useTransition()
  const [prepared, setPrepared] = useState<PreparedMessage | null>(null)
  const [current, setCurrent] = useState<Status>(status)
  const [error, setError] = useState<ActionState | null>(null)

  const run = (fn: () => Promise<ActionState<unknown>>, after?: () => void) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) setError(r as ActionState)
      else {
        setError(null)
        after?.()
      }
    })

  if (current === 'sent' || current === 'cancelled') return null
  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {translateError(t, error.error, error.errorParams)}
        </p>
      )}
      {prepared ? (
        <>
          <label className="text-xs font-medium text-muted" htmlFor={`msg-${taskId}`}>
            {t('messages.preview')} · {prepared.locale === 'ar' ? 'العربية' : 'English'}
          </label>
          <textarea
            id={`msg-${taskId}`}
            readOnly
            value={prepared.text}
            dir={prepared.locale === 'ar' ? 'rtl' : 'ltr'}
            lang={prepared.locale}
            rows={Math.min(10, prepared.text.split('\n').length + 1)}
            className="w-full rounded-xl border border-line bg-cream/60 p-2 text-sm text-ink"
          />
          <div className="flex flex-wrap gap-2">
            <a
              href={prepared.link}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles.primary}
              onClick={() => {
                if (current === 'ready') {
                  setCurrent('opened')
                  void markOpenedAction(taskId)
                }
              }}
            >
              {t('messages.openWhatsapp')}
            </a>
            <CopyButton value={prepared.text} label={t('messages.copyText')} />
          </div>
        </>
      ) : (
        <div>
          <button type="button" className={buttonStyles.secondary} disabled={pending || !online} onClick={() => run(async () => {
            const r = await prepareMessageAction(taskId)
            if (r.ok && r.data) setPrepared(r.data)
            return r
          })}>
            {t('messages.prepare')}
          </button>
        </div>
      )}
      {(prepared || current === 'opened') && <p className="text-xs text-muted">{t('messages.confirmHint')}</p>}
      <div className="flex flex-wrap gap-2">
        {(prepared || current === 'opened') && (
          <button type="button" className={buttonStyles.primary} disabled={pending || !online} onClick={() => run(() => confirmSentAction(taskId), () => { setCurrent('sent'); router.refresh() })}>
            {t('messages.confirmSent')}
          </button>
        )}
        {canDismiss && (
          <button type="button" className={buttonStyles.ghost} disabled={pending || !online} onClick={() => run(() => dismissAction(taskId), () => { setCurrent('cancelled'); router.refresh() })}>
            {t('messages.dismiss')}
          </button>
        )}
      </div>
    </div>
  )
}
