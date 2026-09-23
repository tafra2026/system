import Link from 'next/link'
import { createTranslator } from '@/i18n'
import { getRequestLocale } from '@/server/auth/current'

export default async function NotFound() {
  const t = createTranslator(await getRequestLocale())
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-lg font-semibold text-ink">{t('errors.not_found')}</p>
      <Link href="/" className="text-sm font-medium text-brand-deep underline">
        {t('nav.dashboard')}
      </Link>
    </main>
  )
}
