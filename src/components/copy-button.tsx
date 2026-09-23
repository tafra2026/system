'use client'

import { useState } from 'react'
import { buttonStyles } from './ui'
import { useI18n } from './i18n-provider'

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={buttonStyles.secondary}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          setCopied(false)
        }
      }}
    >
      <span aria-live="polite">{copied ? t('common.copied') : (label ?? t('common.copy'))}</span>
    </button>
  )
}
