import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { Card, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { can } from '@/server/authz/actor'
import { requireActor } from '@/server/auth/current'
import { VipImportForm } from './vip-import-form'

export default async function VipImportPage() {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  if (!can(actor, 'customers.manage') || !can(actor, 'vip.manage')) return <Forbidden message={t('errors.forbidden')} />
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link href="/customers" className="text-sm font-medium text-brand-deep hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader title={t('vipImport.title')} subtitle={t('vipImport.subtitle')} />
      <Card>
        <VipImportForm />
      </Card>
    </div>
  )
}
