import { BrandLogo } from '@/components/brand-logo'
import { LanguageSwitch } from '@/components/shell/language-switch'
import { createTranslator } from '@/i18n'
import { getRequestLocale } from '@/server/auth/current'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale()
  const t = createTranslator(locale)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <BrandLogo label={t('app.name')} height={40} />
        <LanguageSwitch />
      </div>
      {children}
    </main>
  )
}
