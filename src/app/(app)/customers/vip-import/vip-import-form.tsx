'use client'

import { useActionState, useState } from 'react'
import { FormStatus, inputClass, SubmitButton, useFieldErrors } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { Alert, ButtonLink, Stat } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import type { VipImportResult } from '@/server/services/customers'
import { vipImportAction } from './actions'

export function VipImportForm() {
  const { t } = useI18n()
  const [state, action] = useActionState(vipImportAction, { ok: false } as ActionState<VipImportResult>)
  const [list, setList] = useState('')
  const fieldError = useFieldErrors(state)
  const r = state.ok ? state.data : undefined

  if (r?.applied) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success">{t('vipImport.done', { created: r.created.length, upgraded: r.upgraded.length })}</Alert>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/customers?vip=1">{t('vipImport.viewVip')}</ButtonLink>
        </div>
      </div>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormStatus state={state} />
      <label className="text-sm font-medium text-ink" htmlFor="vip-list">
        {t('vipImport.listLabel')}
      </label>
      <textarea
        id="vip-list"
        name="list"
        rows={10}
        value={list}
        onChange={(e) => setList(e.target.value)}
        placeholder={t('vipImport.placeholder')}
        className={inputClass}
        dir="auto"
        required
      />
      {fieldError('list') && <p className="text-sm text-danger">{fieldError('list')}</p>}
      <label className="flex flex-col gap-1 text-sm text-muted">
        {t('vipImport.fileLabel')}
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f && f.size < 1_000_000) setList(await f.text())
          }}
        />
      </label>
      <p className="text-xs text-muted">{t('vipImport.hint')}</p>

      {r && !r.applied && (
        <div className="flex flex-col gap-3 rounded-xl border border-brand/40 bg-brand-soft/40 p-3">
          <p className="text-sm font-semibold text-ink">{t('vipImport.previewTitle')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('vipImport.created')} value={r.created.length} />
            <Stat label={t('vipImport.upgraded')} value={r.upgraded.length} />
            <Stat label={t('vipImport.alreadyVip')} value={r.alreadyVip} />
            <Stat label={t('vipImport.skipped')} value={r.invalid.length + r.duplicates} />
          </div>
          {r.upgraded.length > 0 && (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer content-center font-medium text-ink">{t('vipImport.upgradedList')}</summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                {r.upgraded.map((c) => (
                  <li key={c.phone}>
                    <span dir="auto">{c.name}</span> · <span className="ltr-data">{c.phone}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {r.created.length > 0 && (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer content-center font-medium text-ink">{t('vipImport.createdList')}</summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                {r.created.map((c) => (
                  <li key={c.phone}>
                    <span dir="auto">{c.name}</span> · <span className="ltr-data">{c.phone}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {r.invalid.length > 0 && (
            <Alert tone="warning">
              {t('vipImport.invalidTitle')}{' '}
              {r.invalid.map((i) => t(`vipImport.reasons.${i.reason}`, { line: i.line })).join(t('common.listSeparator'))}
            </Alert>
          )}
          {r.created.length + r.upgraded.length > 0 && (
            <SubmitButton name="mode" value="apply">
              {t('vipImport.apply', { count: r.created.length + r.upgraded.length })}
            </SubmitButton>
          )}
        </div>
      )}
      <SubmitButton variant={r ? 'secondary' : 'primary'} name="mode" value="preview">
        {t('vipImport.preview')}
      </SubmitButton>
    </form>
  )
}
