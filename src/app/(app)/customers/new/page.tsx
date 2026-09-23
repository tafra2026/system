import { Forbidden } from '@/components/forbidden'
import { Card, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { NewCustomerForm } from '../customer-forms'

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const { actor, allowed } = await pagePermission('customers.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const phone = (await searchParams).phone?.slice(0, 40)
  return (
    <div className="max-w-2xl">
      <PageHeader title={t('customers.newTitle')} />
      <Card>
        <NewCustomerForm canVip={can(actor, 'vip.manage')} defaultPhone={phone && /\d{5,}/.test(phone) ? phone : undefined} />
      </Card>
    </div>
  )
}
