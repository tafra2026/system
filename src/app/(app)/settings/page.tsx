import { Forbidden } from '@/components/forbidden'
import { Badge, Card, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { pagePermission } from '@/server/auth/current'
import { mapsConfigured } from '@/server/integrations/google-routes'
import { getAllSettings } from '@/server/services/settings'
import { BufferForm, DaysOffForm, MessageOptionsForm, MessageTemplatesForm, StartPointForm, VipPackagesForm } from './settings-forms'

export default async function SettingsPage() {
  const { actor, allowed } = await pagePermission('settings.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const s = await getAllSettings(actor)
  const maps = mapsConfigured()
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t('settings.title')} />
      <Card title={t('settings.vipPackages')} subtitle={t('settings.vipPackagesHint')}>
        <VipPackagesForm value={s.vip_applies_to_packages} />
      </Card>
      <Card title={t('settings.startPoint')} subtitle={t('settings.startPointHint')}>
        <StartPointForm value={s.start_point} />
      </Card>
      <Card title={t('settings.buffer')} subtitle={t('settings.bufferHint')}>
        <BufferForm value={s.default_buffer_minutes} />
      </Card>
      <Card title={t('settings.daysOff')}>
        <DaysOffForm weekly={s.weekly_days_off} dates={s.days_off} />
      </Card>
      <Card title={t('settings.messagesTitle')} subtitle={t('settings.messagesHint')}>
        <MessageOptionsForm reviewLink={s.review_link} sender={s.on_the_way_sender} />
      </Card>
      <Card title={t('settings.templatesTitle')}>
        <MessageTemplatesForm custom={s.message_templates} />
      </Card>
      <Card title={t('settings.mapsStatus')}>
        <Badge tone={maps ? 'success' : 'warning'}>{maps ? t('settings.mapsOn') : t('settings.mapsOff')}</Badge>
      </Card>
    </div>
  )
}
