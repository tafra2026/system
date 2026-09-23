import type { Metadata } from 'next'
import { I18nProvider } from '@/components/i18n-provider'
import { Card } from '@/components/ui'
import { createTranslator, directionOf, getDictionary } from '@/i18n'
import { getRequestLocale } from '@/server/auth/current'
import { inspectInvite } from '@/server/services/auth'
import { SetupForm } from './setup-form'

export const metadata: Metadata = { title: 'Activate account', referrer: 'no-referrer' }

export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await inspectInvite(token)
  // The invite's language (set from the role) wins over the signed-out cookie on this page.
  const locale = invite?.locale ?? (await getRequestLocale())
  const t = createTranslator(locale)
  if (!invite) {
    return (
      <Card>
        <h1 className="text-xl font-bold text-ink">{t('auth.inviteInvalidTitle')}</h1>
        <p className="mt-2 text-sm text-muted">{t('auth.inviteInvalidBody')}</p>
      </Card>
    )
  }
  const name = locale === 'en' && invite.displayNameEn ? invite.displayNameEn : invite.fullName
  return (
    <I18nProvider locale={locale} dictionary={getDictionary(locale)}>
      <div lang={locale} dir={directionOf(locale)}>
        <Card>
          <h1 className="text-xl font-bold text-ink">{t('auth.setupTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{t('auth.setupWelcome', { name })}</p>
          <p className="mb-5 mt-1 text-sm text-ink">
            {t('auth.setupUsername')} <strong className="ltr-data">{invite.username}</strong>
          </p>
          <SetupForm token={token} defaultLocale={invite.locale} />
        </Card>
      </div>
    </I18nProvider>
  )
}
