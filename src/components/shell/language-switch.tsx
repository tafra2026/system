'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useI18n } from '../i18n-provider'

/** Language toggle for signed-out pages (stored in a cookie until the user signs in). */
export function LanguageSwitch() {
  const { locale } = useI18n()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const next = locale === 'ar' ? 'en' : 'ar'
  return (
    <button
      type="button"
      disabled={pending}
      lang={next}
      className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-brand-deep hover:bg-brand-soft"
      onClick={() =>
        startTransition(async () => {
          await fetch('/api/locale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: next }) })
          router.refresh()
        })
      }
    >
      {next === 'en' ? 'English' : 'العربية'}
    </button>
  )
}
