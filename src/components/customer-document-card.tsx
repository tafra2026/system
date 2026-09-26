'use client'

import { useState, useTransition } from 'react'
import { documentLinkAction, issueDocumentAction } from '@/app/(app)/orders/actions'
import { translateError } from '@/i18n'
import { formatDateTime } from '@/i18n/format'
import { CopyButton } from './copy-button'
import { useI18n } from './i18n-provider'
import { useOnline } from './online-status'
import { buttonStyles, Card } from './ui'

export interface DocRow {
  id: string
  number: string
  version: number
  locale: 'ar' | 'en'
  issuedAt: string
}

/**
 * Customer invoice section of an order. Issue (AR/EN) → preview/print, download, share the
 * file (device share sheet) or send a private download link on WhatsApp. Opening WhatsApp
 * does not attach the PDF and is not recorded as "sent".
 */
export function CustomerDocumentCard({ orderId, docs, days, canIssue }: { orderId: string; docs: DocRow[]; days: number; canIssue: boolean }) {
  const { t, locale } = useI18n()
  const online = useOnline()
  const [pending, start] = useTransition()
  const [note, setNote] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, string>>({})

  const issue = (lang: 'ar' | 'en') =>
    start(async () => {
      const r = await issueDocumentAction(orderId, lang)
      setNote(r.ok ? (r.data?.reused ? t('document.reused') : null) : translateError(t, r.error, r.errorParams))
    })

  const share = async (d: DocRow) => {
    try {
      const res = await fetch(`/api/documents/${d.id}`)
      const file = new File([await res.blob()], `${d.number}.pdf`, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: d.number })
      else window.open(`/api/documents/${d.id}?download=1`, '_blank')
    } catch {
      // Share sheet dismissed: nothing to do.
    }
  }

  const whatsapp = (d: DocRow) =>
    start(async () => {
      const win = window.open('', '_blank', 'noopener')
      const r = await documentLinkAction(d.id)
      if (r.ok && r.data) {
        setLinks((m) => ({ ...m, [d.id]: r.data!.url }))
        if (win) win.location.href = r.data.wa
      } else {
        win?.close()
        setNote(translateError(t, r.error))
      }
    })

  return (
    <Card title={t('document.card')} subtitle={t('document.cardHint')}>
      {canIssue && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" className={buttonStyles.primary} disabled={pending || !online} onClick={() => issue('ar')}>
            {t('document.issueAr')}
          </button>
          <button type="button" className={buttonStyles.secondary} disabled={pending || !online} onClick={() => issue('en')}>
            {t('document.issueEn')}
          </button>
        </div>
      )}
      {note && (
        <p role="status" className="mb-2 text-sm text-muted">
          {note}
        </p>
      )}
      {docs.length === 0 ? (
        <p className="text-sm text-muted">{t('document.none')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-3">
              <p className="flex flex-wrap gap-x-3 text-sm">
                <span className="ltr-data font-semibold text-ink">{d.number}</span>
                <span className="text-muted">{d.locale === 'ar' ? 'العربية' : 'English'}</span>
                {d.version > 1 && <span className="text-muted">v{d.version}</span>}
                <bdi className="text-muted">{formatDateTime(new Date(d.issuedAt), locale)}</bdi>
              </p>
              <div className="flex flex-wrap gap-2">
                <a className={buttonStyles.secondary} href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">
                  {t('document.open')}
                </a>
                <a className={buttonStyles.secondary} href={`/api/documents/${d.id}?download=1`}>
                  {t('document.download')}
                </a>
                <button type="button" className={buttonStyles.secondary} onClick={() => share(d)}>
                  {t('document.share')}
                </button>
                {canIssue && (
                  <button type="button" className={buttonStyles.primary} disabled={pending || !online} onClick={() => whatsapp(d)}>
                    {t('document.whatsapp')}
                  </button>
                )}
              </div>
              {links[d.id] && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{t('document.linkNote', { days })}</span>
                  <CopyButton value={links[d.id]!} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
