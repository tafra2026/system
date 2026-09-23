import { Forbidden } from '@/components/forbidden'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator, type MessageKey } from '@/i18n'
import { formatDateTime } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { listAudit } from '@/server/services/audit-read'

export default async function AuditPage() {
  const { actor, allowed } = await pagePermission('audit.read')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const rows = await listAudit(actor, 200)
  const actionLabel = (action: string) => {
    const key = `audit.actions.${action}` as MessageKey
    const label = t(key)
    return label === key ? action : label
  }
  return (
    <div>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle', { count: rows.length })} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState body={t('audit.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="grid grid-cols-1 gap-1 py-2.5 text-sm sm:grid-cols-[11rem_1fr_12rem]">
                <span className="text-muted">{formatDateTime(r.occurredAt, actor.locale)}</span>
                <span className="font-medium text-ink">
                  {actionLabel(r.action)}
                  {r.reason && (
                    <span className="block text-xs font-normal text-muted" dir="auto">
                      {t('audit.reason')}: {r.reason}
                    </span>
                  )}
                </span>
                <span className="text-muted sm:text-end">{r.actorName ?? t('audit.system')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
