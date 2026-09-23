import { BrandLogo } from '@/components/brand-logo'
import { LanguageSwitch } from '@/components/shell/language-switch'
import { createTranslator } from '@/i18n'
import { getRequestLocale } from '@/server/auth/current'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale()
  const t = createTranslator(locale)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      <div className="mb-4 flex justify-end">
        <LanguageSwitch />
      </div>
      <div className="mb-6 flex items-center justify-center rounded-[var(--radius-card)] bg-brand px-6 py-10">
        <BrandLogo label={t('app.fullName')} height={64} />
      </div>
      {children}
    </main>
  )
}
