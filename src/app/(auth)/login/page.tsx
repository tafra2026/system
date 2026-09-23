import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { getCurrentActor, getRequestLocale } from '@/server/auth/current'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage() {
  if (await getCurrentActor()) redirect('/')
  const t = createTranslator(await getRequestLocale())
  return (
    <Card>
      <h1 className="text-xl font-bold text-ink">{t('auth.loginTitle')}</h1>
      <p className="mb-5 text-sm text-muted">{t('auth.loginSubtitle')}</p>
      <LoginForm />
      <p className="mt-5 text-xs text-muted">{t('auth.noAccountHint')}</p>
    </Card>
  )
}
