import { AppSetup } from '@/components/app-setup'
import { PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { requireActor } from '@/server/auth/current'
import { pushPublicKey } from '@/server/push'

export default async function AppSetupPage() {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t('setup.title')} subtitle={t('setup.subtitle')} />
      <AppSetup publicKey={pushPublicKey()} />
    </div>
  )
}
