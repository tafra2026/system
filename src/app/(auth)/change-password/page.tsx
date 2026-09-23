import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { getCurrentActor, getPasswordChangeActor } from '@/server/auth/current'
import { ChangePasswordForm } from './change-password-form'

export const metadata: Metadata = { title: 'Choose your password' }

export default async function ChangePasswordPage() {
  if (await getCurrentActor()) redirect('/')
  const actor = await getPasswordChangeActor()
  if (!actor) redirect('/login')
  const t = createTranslator(actor.locale)
  return (
    <Card>
      <h1 className="text-xl font-bold text-ink">{t('auth.forcedChangeTitle')}</h1>
      <p className="mb-5 text-sm text-muted">{t('auth.forcedChangeBody', { name: actor.displayName })}</p>
      <ChangePasswordForm />
    </Card>
  )
}
