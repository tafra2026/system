import { Forbidden } from '@/components/forbidden'
import { Card, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { pagePermission } from '@/server/auth/current'
import { getAllSettings } from '@/server/services/settings'
import { VipPackagesForm } from './settings-forms'

export default async function SettingsPage() {
  const { actor, allowed } = await pagePermission('settings.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const s = await getAllSettings(actor)
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t('settings.title')} />
      <Card title={t('settings.vipPackages')} subtitle={t('settings.vipPackagesHint')}>
        <VipPackagesForm value={s.vip_applies_to_packages} />
      </Card>
    </div>
  )
}
