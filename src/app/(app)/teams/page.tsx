import { Forbidden } from '@/components/forbidden'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { riyadhToday } from '@/domain/operational-day'
import { createTranslator } from '@/i18n'
import { formatCalendarDate } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { listStaff } from '@/server/services/staff'
import { listTeams } from '@/server/services/teams'
import { MembershipForm, NewTeamForm } from './team-forms'

export default async function TeamsPage() {
  const { actor, allowed } = await pagePermission('staff.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const today = riyadhToday()
  const [teams, staff] = await Promise.all([listTeams(actor, today), listStaff(actor)])
  const movable = staff.filter((s) => (s.role === 'driver' || s.role === 'specialist') && s.status === 'active')
  const name = (s: (typeof staff)[number]) => (actor.locale === 'en' && s.displayNameEn ? s.displayNameEn : s.fullName)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('teams.title')} subtitle={t('teams.subtitle')} />
      {teams.length === 0 ? (
        <Card>
          <EmptyState body={t('teams.noTeams')} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {teams.map((tm) => (
            <Card key={tm.id} title={tm.name} subtitle={t('teams.members')}>
              {tm.members.length === 0 ? (
                <p className="text-sm text-muted">{t('teams.noMembers')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {tm.members.map((m) => (
                    <li key={m.employeeId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-ink">{m.name}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={m.role === 'driver' ? 'warning' : 'brand'}>{t(`roles.${m.role}`)}</Badge>
                        <span className="text-xs text-muted">{t('teams.since', { date: formatCalendarDate(m.since, actor.locale, false) })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
      <Card title={t('teams.assignTitle')}>
        <MembershipForm today={today} teams={teams.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name }))} employees={movable.map((s) => ({ id: s.id, label: `${name(s)} — ${t(`roles.${s.role}`)}` }))} />
      </Card>
      <Card title={t('teams.new')}>
        <NewTeamForm />
      </Card>
    </div>
  )
}
