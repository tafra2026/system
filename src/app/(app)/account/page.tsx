import { Badge, Card, DefinitionList, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { requireActor } from '@/server/auth/current'
import { LanguageForm, PasswordForm } from './account-forms'

export default async function AccountPage() {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
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
      <Card title={t('account.languageTitle')}>
        <LanguageForm />
      </Card>
      <Card title={t('account.passwordTitle')}>
        <PasswordForm />
      </Card>
    </div>
  )
}
