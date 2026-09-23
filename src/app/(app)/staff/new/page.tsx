import { Forbidden } from '@/components/forbidden'
import { Card, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { riyadhMonthStart } from '@/domain/operational-day'
import { pagePermission } from '@/server/auth/current'
import { NewEmployeeForm } from './new-employee-form'

export default async function NewEmployeePage() {
  const { actor, allowed } = await pagePermission('staff.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  return (
    <div className="max-w-2xl">
      <PageHeader title={t('staff.addTitle')} />
      <Card>
        <NewEmployeeForm defaultEffectiveFrom={riyadhMonthStart()} />
      </Card>
    </div>
  )
}
