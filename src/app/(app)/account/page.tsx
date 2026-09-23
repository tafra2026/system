import { Badge, Card, DefinitionList, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { requireActor } from '@/server/auth/current'
import { LanguageForm, PasswordForm } from './account-forms'
import { getEmployeeTimeOff } from '@/server/services/time-off'
import { formatCalendarDate } from '@/i18n/format'
import { PushSettings } from '@/components/push-settings'
import { pushPublicKey } from '@/server/push'

export default async function AccountPage() {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  const off = await getEmployeeTimeOff(actor, actor.employeeId)
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t('account.title')} />
      <Card title={t('account.profile')}>
        <DefinitionList
          items={[
            { label: t('staff.fullName'), value: actor.displayName },
            { label: t('staff.role'), value: <Badge tone="brand">{t(`roles.${actor.role}`)}</Badge> },
            { label: t('staff.username'), value: <span className="ltr-data">{actor.username}</span> },
          ]}
        />
      </Card>
      <Card title={t('timeoff.mine')}>
        {off.weekly.length > 0 && (
          <p className="text-sm text-ink">
            {t('timeoff.weekly')}: {off.weekly.map((d) => t(`settings.weekdays.${String(d) as '0'}`)).join(actor.locale === 'ar' ? '، ' : ', ')}
          </p>
        )}
        {off.dates.length === 0 ? (
          off.weekly.length === 0 && <p className="text-sm text-muted">{t('timeoff.none')}</p>
        ) : (
          <ul className="mt-1 text-sm text-ink">
            {off.dates.map((d) => (
              <li key={d.id}>• {formatCalendarDate(d.date, actor.locale)}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('notifications.push.title')} subtitle={t('notifications.push.subtitle')}>
        <PushSettings publicKey={pushPublicKey()} />
      </Card>
      <Card title={t('account.languageTitle')}>
        <LanguageForm />
      </Card>
      <Card title={t('account.passwordTitle')}>
        <PasswordForm />
      </Card>
    </div>
  )
}
