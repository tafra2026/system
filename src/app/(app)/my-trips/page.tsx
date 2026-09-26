import Link from 'next/link'
import { AutoRefresh } from '@/components/auto-refresh'
import { Forbidden } from '@/components/forbidden'
import { inputClass } from '@/components/form-styles'
import { TripsList } from '@/components/trips-list'
import { buttonStyles, Card, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { pagePermission } from '@/server/auth/current'
import { myOnTheWayTasks } from '@/server/services/messages'
import { myTeam } from '@/server/services/teams'
import { toDriverLegs } from '@/server/services/trip-views'
import { myTripsView, type DriverView } from '@/server/services/trips'

const VIEWS: DriverView[] = ['today', 'upcoming', 'completed', 'date']

export default async function MyTripsPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const { actor, allowed } = await pagePermission('schedule.read.own')
  const t = createTranslator(actor.locale)
  if (!allowed || actor.role !== 'driver') return <Forbidden message={t('errors.forbidden')} />
  const sp = await searchParams
  const view = VIEWS.find((v) => v === sp.view) ?? 'today'
  const legs = await myTripsView(actor, view, sp.date)
  const [onTheWay, team] = await Promise.all([myOnTheWayTasks(actor, legs.map((l) => l.visitId)), myTeam(actor)])
  return (
    <div className="flex flex-col gap-4">
      {/* New or changed assignments appear within ~5 seconds. */}
      <AutoRefresh everyMs={5000} />
      <PageHeader title={t('trips.myTitle')} />
      <nav aria-label={t('trips.myTitle')} className="flex flex-wrap items-end gap-2">
        {VIEWS.filter((v) => v !== 'date').map((v) => (
          <Link key={v} href={`/my-trips?view=${v}`} aria-current={v === view ? 'page' : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${v === view ? 'border-brand-deep bg-brand-deep text-white' : 'border-line bg-surface text-brand-deep'}`}>
            {t(`trips.views.${v}`)}
          </Link>
        ))}
        <form className="flex items-end gap-2" action="/my-trips">
          <input type="hidden" name="view" value="date" />
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('trips.views.date')}
            <input type="date" name="date" defaultValue={view === 'date' ? sp.date : undefined} className={inputClass} dir="ltr" required />
          </label>
          <button type="submit" className={buttonStyles.secondary}>
            {t('trips.show')}
          </button>
        </form>
      </nav>
      <TripsList legs={toDriverLegs(legs, onTheWay)} />
      <Card title={t('trips.team')}>
        {team ? (
          <p className="text-sm text-ink">
            <strong>{team.name}</strong>: {team.members.map((m) => `${m.name} (${t(`roles.${m.role}`)})`).join(t('common.listSeparator'))}
          </p>
        ) : (
          <p className="text-sm text-muted">{t('trips.noTeam')}</p>
        )}
      </Card>
    </div>
  )
}
