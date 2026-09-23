import { createTranslator } from '@/i18n'
import { getRequestLocale } from '@/server/auth/current'

/** Shown by the service worker when a page cannot be loaded without a connection. */
export default async function OfflinePage() {
  const t = createTranslator(await getRequestLocale())
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-bold text-ink">{t('offline.title')}</h1>
      <p className="text-sm text-muted">{t('offline.body')}</p>
    </main>
  )
}
