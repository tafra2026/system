import { createTranslator } from '@/i18n'
import { getRequestLocale } from '@/server/auth/current'

export default async function Loading() {
  const t = createTranslator(await getRequestLocale())
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{t('common.loading')}</span>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-brand-soft" />
      <div className="h-32 animate-pulse rounded-2xl bg-surface" />
      <div className="h-32 animate-pulse rounded-2xl bg-surface" />
    </div>
  )
}
