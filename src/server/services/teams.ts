import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { riyadhToday } from '@/domain/operational-day'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { employees, teamMembers, teams } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'
import { pgErrorCode } from './validation'

const displayName = (e: { fullName: string; displayNameEn: string | null }, locale: 'ar' | 'en') => (locale === 'en' && e.displayNameEn ? e.displayNameEn : e.fullName)

/** Membership rows in effect on a date. */
function activeOn(date: string) {
  return and(lte(teamMembers.effectiveFrom, date), or(isNull(teamMembers.effectiveTo), gt(teamMembers.effectiveTo, date)))
}

/** Teams with their members on a date (default today). Management and schedulers. */
export async function listTeams(actor: Actor, date: string = riyadhToday()) {
  if (!can(actor, 'staff.manage') && !can(actor, 'schedule.manage')) throw new ForbiddenError('schedule.manage')
  const db = getDb()
  const all = await db.select().from(teams).orderBy(asc(teams.createdAt))
  const members = await db
    .select({ teamId: teamMembers.teamId, employeeId: employees.id, role: employees.role, fullName: employees.fullName, displayNameEn: employees.displayNameEn, since: teamMembers.effectiveFrom })
    .from(teamMembers)
    .innerJoin(employees, eq(employees.id, teamMembers.employeeId))
    .where(activeOn(date))
  return all.map((t) => ({
    ...t,
    members: members.filter((m) => m.teamId === t.id).map((m) => ({ employeeId: m.employeeId, role: m.role, name: displayName(m, actor.locale), since: m.since })),
  }))
}

export async function createTeam(actor: Actor, name: string) {
  authorize(actor, 'staff.manage')
  const n = z.string().trim().min(1).max(80).safeParse(name)
  if (!n.success) throw new ValidationError('validation_failed', { name: 'required' })
  return getDb().transaction(async (tx) => {
    const [t] = await tx.insert(teams).values({ name: n.data }).returning()
    await writeAudit(tx, { actorUserId: actor.userId, action: 'team.create', entityType: 'team', entityId: t!.id, after: { name: n.data } })
    return t!
  })
}

/**
 * Move an employee (driver or specialist) to a team — or out of any team — from a date.
 * The date cannot be in the past: earlier days keep the team they had (spec §4, §5).
 */
export async function setTeamMembership(actor: Actor, employeeId: string, teamId: string | null, effectiveFrom: string) {
  authorize(actor, 'staff.manage')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new ValidationError('validation_failed', { effectiveFrom: 'invalid' })
  if (effectiveFrom < riyadhToday()) throw new ValidationError('validation_failed', { effectiveFrom: 'team_backdated' })
  try {
    await getDb().transaction(async (tx) => {
      const [emp] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for('update')
      if (!emp) throw new NotFoundError()
      if (!['driver', 'specialist'].includes(emp.role)) throw new ValidationError('validation_failed', { employeeId: 'team_role_invalid' })
      if (teamId) {
        const [t] = await tx.select().from(teams).where(eq(teams.id, teamId))
        if (!t || !t.active) throw new ValidationError('validation_failed', { teamId: 'invalid' })
      }
      const open = await tx.select().from(teamMembers).where(and(eq(teamMembers.employeeId, employeeId), isNull(teamMembers.effectiveTo)))
      for (const m of open) {
        if (m.teamId === teamId) return // already there
        if (m.effectiveFrom >= effectiveFrom) throw new ValidationError('validation_failed', { effectiveFrom: 'team_change_conflict' })
        await tx.update(teamMembers).set({ effectiveTo: effectiveFrom }).where(eq(teamMembers.id, m.id))
      }
      if (teamId) await tx.insert(teamMembers).values({ teamId, employeeId, effectiveFrom, createdByUserId: actor.userId })
      await writeAudit(tx, { actorUserId: actor.userId, action: 'team.membership', entityType: 'employee', entityId: employeeId, before: { teamId: open[0]?.teamId ?? null }, after: { teamId, effectiveFrom } })
    })
  } catch (err) {
    if (pgErrorCode(err) === '23P01') throw new ValidationError('validation_failed', { effectiveFrom: 'team_change_conflict' })
    throw err
  }
}

/** Team id of each employee on a date. */
export async function teamsOn(db: Executor, employeeIds: string[], date: string): Promise<Map<string, string>> {
  if (!employeeIds.length) return new Map()
  const rows = await db.select().from(teamMembers).where(and(inArray(teamMembers.employeeId, employeeIds), activeOn(date)))
  return new Map(rows.map((r) => [r.employeeId, r.teamId]))
}

/** The signed-in driver's/specialist's own team on a date: names and roles only. */
export async function myTeam(actor: Actor, date: string = riyadhToday()) {
  authorize(actor, 'team.read.own')
  const db = getDb()
  const mine = await teamsOn(db, [actor.employeeId], date)
  const teamId = mine.get(actor.employeeId)
  if (!teamId) return null
  const [t] = await db.select().from(teams).where(eq(teams.id, teamId))
  const members = await db
    .select({ id: employees.id, role: employees.role, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
    .from(teamMembers)
    .innerJoin(employees, eq(employees.id, teamMembers.employeeId))
    .where(and(eq(teamMembers.teamId, teamId), activeOn(date)))
  return { name: t!.name, members: members.filter((m) => m.id !== actor.employeeId).map((m) => ({ role: m.role, name: displayName(m, actor.locale) })) }
}
