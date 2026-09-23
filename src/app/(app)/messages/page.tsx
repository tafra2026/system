import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { MessageTaskActions } from '@/components/message-task'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatDateTime } from '@/i18n/format'
import { can } from '@/server/authz/actor'
import { requireActor } from '@/server/auth/current'
import { listMessageTasks, type MessageListScope } from '@/server/services/messages'

const SCOPES: MessageListScope[] = ['due', 'upcoming', 'done']
const STATUS_TONE = { ready: 'brand', opened: 'warning', sent: 'success', cancelled: 'neutral' } as const

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  const manage = can(actor, 'messages.send')
  if (!manage && actor.role !== 'driver') return <Forbidden message={t('errors.forbidden')} />
  const requested = (await searchParams).tab
  const tab = SCOPES.find((s) => s === requested) ?? 'due'
  const rows = await listMessageTasks(actor, tab)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('messages.title')} subtitle={t('messages.subtitle')} />
      <Alert>{t('messages.howItWorks')}</Alert>
      <nav aria-label={t('messages.title')} className="flex flex-wrap gap-2">
        {SCOPES.map((s) => (
          <Link
            key={s}
            href={`/messages?tab=${s}`}
            aria-current={s === tab ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-semibold ${s === tab ? 'border-brand-deep bg-brand-deep text-white' : 'border-line bg-surface text-brand-deep'}`}
          >
            {t(`messages.tabs.${s}`)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card>
          <EmptyState body={t(`messages.empty.${tab}`)} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{t(`messages.kinds.${r.kind}`)}</span>
                    <Badge tone={STATUS_TONE[r.status]}>{tab === 'upcoming' ? t('messages.scheduled') : t(`messages.statuses.${r.status}`)}</Badge>
                    {r.late && <Badge tone="danger">{t('messages.late')}</Badge>}
                    {r.assignedToMe && <Badge tone="brand">{t('messages.assignedToMe')}</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    <span dir="auto" className="text-ink">{r.customerName}</span>
                    {manage ? (
                      <Link href={`/orders/${r.orderId}`} className="ltr-data text-brand-deep underline">
                        {r.orderReference}
                      </Link>
                    ) : (
                      <span className="ltr-data">{r.orderReference}</span>
                    )}
                    {r.visitStartsAt && (
                      <span>
                        {t('messages.visitAt')}: <bdi>{formatDateTime(r.visitStartsAt, actor.locale)}</bdi>
                      </span>
                    )}
                    <span>
                      {tab === 'done' ? t('messages.updatedAt') : t('messages.dueAt')}: <bdi>{formatDateTime(tab === 'done' && r.sentConfirmedAt ? r.sentConfirmedAt : r.dueAt, actor.locale)}</bdi>
                    </span>
                    {r.assigneeName && !r.assignedToMe && <span>{t('messages.assignee')}: {r.assigneeName}</span>}
                    {r.status === 'cancelled' && r.cancelReason && <span>{t(`messages.cancelReasons.${r.cancelReason === 'dismissed' ? 'dismissed' : 'superseded'}`)}</span>}
                  </div>
                  {tab === 'due' && <MessageTaskActions taskId={r.id} status={r.status} canDismiss={manage} />}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
