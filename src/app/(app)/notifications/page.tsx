import { Card, EmptyState, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatDateTime } from '@/i18n/format'
import { requireActor } from '@/server/auth/current'
import { myNotifications } from '@/server/services/notifications'
import { markAllReadAction, openNotificationAction } from './actions'

export default async function NotificationsPage() {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  const items = await myNotifications(actor)
  const unread = items.some((n) => !n.read)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        actions={
          unread ? (
            <form action={markAllReadAction}>
              <button type="submit" className="min-h-11 rounded-xl border border-brand/60 bg-surface px-4 text-sm font-semibold text-brand-deep hover:bg-brand-soft">
                {t('notifications.markAllRead')}
              </button>
            </form>
          ) : undefined
        }
      />
      <Card>
        {items.length === 0 ? (
          <EmptyState body={t('notifications.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id}>
                <form action={openNotificationAction.bind(null, n.id)}>
                  <button type="submit" className="flex w-full flex-col items-start gap-0.5 py-3 text-start hover:bg-cream">
                    <span className="flex items-center gap-2">
                      {!n.read && <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-brand-deep" />}
                      <span className={`text-sm ${n.read ? 'text-ink' : 'font-bold text-ink'}`}>{n.title}</span>
                      {!n.read && <span className="sr-only">{t('notifications.unread')}</span>}
                    </span>
                    <span className="text-sm text-muted">{n.body}</span>
                    <bdi className="text-xs text-muted">{formatDateTime(n.createdAt, actor.locale)}</bdi>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
