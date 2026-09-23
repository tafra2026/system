import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { authorize, type Actor } from '../authz/actor'
import { defaultLocaleForRole } from '../authz/permissions'
import { writeAudit } from '../audit'
import { newToken, sha256 } from '../auth/crypto'
import { getDb, type Executor } from '../db'
import { accountInvites, employees, users } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'

export const INVITE_TTL_HOURS = 48

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/)

/** Build the public setup URL for a raw invite token. */
export function setupUrl(token: string): string {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/setup/${token}`
}

/** Revoke previous unused links, create a new one, and return the RAW token (shown once). */
async function issueInviteTx(tx: Executor, userId: string, actorUserId: string | null): Promise<{ token: string; expiresAt: Date }> {
  const now = new Date()
  await tx
    .update(accountInvites)
    .set({ revokedAt: now })
    .where(and(eq(accountInvites.userId, userId), isNull(accountInvites.usedAt), isNull(accountInvites.revokedAt)))
  const token = newToken()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 3600_000)
  await tx.insert(accountInvites).values({ userId, tokenHash: sha256(token), expiresAt, createdByUserId: actorUserId })
  await writeAudit(tx, {
    actorUserId,
    action: 'account.invite_issued',
    entityType: 'user',
    entityId: userId,
    after: { expiresAt: expiresAt.toISOString() },
  })
  return { token, expiresAt }
}

/**
 * Create a login account for an employee. The account stays `pending` (cannot sign in)
 * until the employee opens the one-time link and sets her own password.
 * `actor` is null only for the server-side bootstrap script.
 */
export async function createAccount(actor: Actor | null, employeeId: string, usernameInput: unknown) {
  if (actor) authorize(actor, 'accounts.manage')
  const username = usernameSchema.safeParse(usernameInput)
  if (!username.success) throw new ValidationError('validation_failed', { username: 'username_invalid' })

  return getDb().transaction(async (tx) => {
    const [emp] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for('update')
    if (!emp) throw new NotFoundError()
    if (emp.status !== 'active') throw new ValidationError('employee_not_active')
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.employeeId, employeeId)).limit(1)
    if (existing) throw new ValidationError('account_exists')
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username.data)).limit(1)
    if (taken) throw new ValidationError('validation_failed', { username: 'username_taken' })

    const [user] = await tx
      .insert(users)
      .values({ employeeId, username: username.data, locale: defaultLocaleForRole(emp.role), status: 'pending' })
      .returning()
    await writeAudit(tx, {
      actorUserId: actor?.userId ?? null,
      action: 'account.create',
      entityType: 'user',
      entityId: user!.id,
      after: { employeeId, username: user!.username, locale: user!.locale },
    })
    const invite = await issueInviteTx(tx, user!.id, actor?.userId ?? null)
    return { userId: user!.id, ...invite }
  })
}

/** New setup link (e.g. lost link or password reset). Existing sessions are ended when it is used. */
export async function reissueInvite(actor: Actor | null, userId: string) {
  if (actor) authorize(actor, 'accounts.manage')
  return getDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
    if (!user) throw new NotFoundError()
    return issueInviteTx(tx, userId, actor?.userId ?? null)
  })
}

export async function setAccountSuspended(actor: Actor, userId: string, suspended: boolean) {
  authorize(actor, 'accounts.manage')
  return getDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
    if (!user) throw new NotFoundError()
    if (user.id === actor.userId) throw new ValidationError('cannot_deactivate_self')
    const next = suspended ? 'suspended' : user.passwordHash ? 'active' : 'pending'
    if (!suspended) {
      const [emp] = await tx.select({ status: employees.status }).from(employees).where(eq(employees.id, user.employeeId))
      if (emp?.status !== 'active') throw new ValidationError('employee_not_active')
    }
    await tx.update(users).set({ status: next, updatedAt: new Date() }).where(eq(users.id, userId))
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: suspended ? 'account.suspend' : 'account.reactivate',
      entityType: 'user',
      entityId: userId,
      before: { status: user.status },
      after: { status: next },
    })
  })
}
