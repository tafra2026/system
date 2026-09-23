import { createTranslator } from '@/i18n'
import { formatDateTime } from '@/i18n/format'
import type { Actor } from '@/server/authz/actor'
import { can } from '@/server/authz/actor'
import { orderMessageTasks } from '@/server/services/messages'
import { MessageTaskActions } from './message-task'
import { Badge, Card } from './ui'

const STATUS_TONE = { ready: 'brand', opened: 'warning', sent: 'success', cancelled: 'neutral' } as const

/** WhatsApp messages of one order: prepare, open the chat, confirm sending. */
export async function OrderMessagesCard({ actor, orderId }: { actor: Actor; orderId: string }) {
  if (!can(actor, 'messages.send')) return null
  const t = createTranslator(actor.locale)
  const tasks = await orderMessageTasks(actor, orderId)
  if (tasks.length === 0) return null
  const now = Date.now()
  return (
    <Card title={t('messages.orderCard')} subtitle={t('messages.notProof')}>
      <ul className="divide-y divide-line">
        {tasks.map((m) => {
          const future = m.status === 'ready' && m.dueAt.getTime() > now
          return (
            <li key={m.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-ink">{t(`messages.kinds.${m.kind}`)}</span>
                <Badge tone={STATUS_TONE[m.status]}>{future ? t('messages.scheduled') : t(`messages.statuses.${m.status}`)}</Badge>
                <span className="text-xs text-muted">
                  {m.status === 'sent' && m.sentConfirmedAt ? t('messages.confirmedAt') : t('messages.dueAt')}: <bdi>{formatDateTime(m.status === 'sent' && m.sentConfirmedAt ? m.sentConfirmedAt : m.dueAt, actor.locale)}</bdi>
                </span>
              </div>
              {!future && <MessageTaskActions taskId={m.id} status={m.status} canDismiss />}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
