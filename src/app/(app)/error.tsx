'use client'

import { useI18n } from '@/components/i18n-provider'
import { Alert, buttonStyles } from '@/components/ui'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert tone="error">{t('errors.generic')}</Alert>
      {error.digest && <p className="text-xs text-muted" dir="auto">{t('errors.supportCode', { code: error.digest })}</p>}
      <button type="button" className={buttonStyles.secondary} onClick={() => reset()}>
        {t('common.retry')}
      </button>
    </div>
  )
}
