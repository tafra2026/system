import Link from 'next/link'
import { Forbidden } from '@/components/forbidden'
import { visitStatusTone } from '@/components/status-tones'
import { Badge, buttonStyles, Card, EmptyState, PageHeader } from '@/components/ui'
import { addDays, operationalDateOf } from '@/domain/operational-day'
import { createTranslator } from '@/i18n'
import { formatCalendarDate, formatTime } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { calendarRange } from '@/server/services/trips'

/** Week starts on Sunday (Saudi working week). */
function weekStart(date: string) {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay()
  return addDays(date, -wd)
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string }> }) {
  const { actor, allowed } = await pagePermission('orders.read.all')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const sp = await searchParams
  const view = sp.view === 'week' ? 'week' : 'day'
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : operationalDateOf(new Date())
  const from = view === 'week' ? weekStart(date) : date
  const to = view === 'week' ? addDays(from, 6) : date
  const visits = await calendarRange(actor, from, to)
  const step = view === 'week' ? 7 : 1
  const link = (d: string, v = view) => `/calendar?view=${v}&date=${d}`
  const time = (d: Date) => formatTime(d, actor.locale)

  const VisitChip = ({ v, compact }: { v: (typeof visits)[number]; compact?: boolean }) => (
    <Link href={`/orders/${v.orderId}`} className="block rounded-lg border border-line bg-surface p-2 text-sm hover:border-brand">
      <span className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-semibold text-ink">
          <bdi>{time(v.startsAt)}</bdi> – <bdi>{time(new Date(v.startsAt.getTime() + v.durationMinutes * 60_000))}</bdi>
        </span>
        <Badge tone={visitStatusTone[v.status]}>{t(`visitStatus.${v.status}`)}</Badge>
      </span>
      <span className="block text-ink" dir="auto">
        {v.customerName}
        {v.district ? ` · ${v.district}` : ''}
      </span>
      {!compact && (
        <span className="block text-xs text-muted">
          {v.specialists.map((s) => s.name).join(t('common.listSeparator'))}
          {v.legs.map((l) => (
            <span key={l.kind}>
              {' · '}
              {l.kind === 'dropoff' ? t('trips.dropoff') : t('trips.pickup')}: {l.driverName} <bdi>{time(l.departAt)}</bdi>
            </span>
          ))}
        </span>
      )}
    </Link>
  )

  // Day view lanes: one per specialist (a visit with two specialists appears in both lanes).
  const lanes = new Map<string, { name: string; visits: typeof visits }>()
  for (const v of visits) {
    for (const s of v.specialists.length ? v.specialists : [{ id: '_', name: t('calendar.unassignedLane') }]) {
      const lane = lanes.get(s.id) ?? { name: s.name, visits: [] }
      lane.visits.push(v)
      lanes.set(s.id, lane)
    }
  }
  const driverLegs = visits.flatMap((v) => v.legs.map((l) => ({ ...l, v }))).sort((a, b) => a.departAt.getTime() - b.departAt.getTime())

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('calendar.title')} subtitle={view === 'week' ? `${formatCalendarDate(from, actor.locale, false)} – ${formatCalendarDate(to, actor.locale, false)}` : formatCalendarDate(date, actor.locale)} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={link(addDays(date, -step))} className={buttonStyles.secondary}>
          {t('calendar.previous')}
        </Link>
        <Link href={link(operationalDateOf(new Date()))} className={buttonStyles.secondary}>
          {t('calendar.today')}
        </Link>
        <Link href={link(addDays(date, step))} className={buttonStyles.secondary}>
          {t('calendar.next')}
        </Link>
        <span className="mx-2 h-6 w-px bg-line" />
        <Link href={link(date, 'day')} aria-current={view === 'day' ? 'page' : undefined} className={view === 'day' ? buttonStyles.primary : buttonStyles.ghost}>
          {t('calendar.day')}
        </Link>
        <Link href={link(date, 'week')} aria-current={view === 'week' ? 'page' : undefined} className={view === 'week' ? buttonStyles.primary : buttonStyles.ghost}>
          {t('calendar.week')}
        </Link>
      </div>

      {view === 'day' ? (
        visits.length === 0 ? (
          <Card>
            <EmptyState body={t('calendar.empty')} />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...lanes.values()].map((lane) => (
              <Card key={lane.name} title={lane.name}>
                <div className="flex flex-col gap-2">
                  {lane.visits.map((v) => (
                    <VisitChip key={v.visitId} v={v} />
                  ))}
                </div>
              </Card>
            ))}
            {driverLegs.length > 0 && (
              <Card title={t('calendar.drivers')} subtitle={t('trips.estimateNote')}>
                <ul className="flex flex-col gap-1 text-sm">
                  {driverLegs.map((l, i) => (
                    <li key={i} className="rounded-lg bg-cream/70 px-2 py-1">
                      <span className="font-semibold">
                        <bdi>{time(l.departAt)}</bdi> – <bdi>{time(l.arriveAt)}</bdi>
                      </span>{' '}
                      {l.driverName} · {l.kind === 'dropoff' ? t('trips.dropoff') : t('trips.pickup')} · <span dir="auto">{l.v.district ?? l.v.customerName}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => {
            const dayVisits = visits.filter((v) => v.operationalDate === d)
            return (
              <section key={d} className="rounded-[var(--radius-card)] border border-line bg-surface p-2">
                <Link href={link(d, 'day')} className="mb-2 block text-sm font-semibold text-brand-deep hover:underline">
                  {formatCalendarDate(d, actor.locale, true)}
                </Link>
                <p className="mb-1 text-xs text-muted">{t('calendar.visitsCount', { count: dayVisits.length })}</p>
                <div className="flex flex-col gap-1.5">
                  {dayVisits.map((v) => (
                    <VisitChip key={v.visitId} v={v} compact />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
