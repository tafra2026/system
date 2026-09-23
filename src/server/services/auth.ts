import { and, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Actor } from '../authz/actor'
import { writeAudit } from '../audit'
import { hashPassword, PASSWORD_MIN_LENGTH, sha256, verifyPassword } from '../auth/crypto'
import { createSession, deleteAllSessionsForUser } from '../auth/sessions'
import { getDb } from '../db'
import { accountInvites, employees, users } from '../db/schema'
import { ValidationError } from './errors'

const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15
// Verifying against a real hash when the user does not exist keeps timing uniform.
let dummyHash: Promise<string> | null = null

export function validateNewPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 200) {
    throw new ValidationError('validation_failed', { password: 'password_too_short' })
  }
  return password
}

export type LoginResult = { ok: true; token: string; expiresAt: Date; locale: 'ar' | 'en'; mustChangePassword: boolean } | { ok: false; code: 'invalid_credentials' | 'account_locked' }

export async function login(usernameInput: unknown, passwordInput: unknown): Promise<LoginResult> {
  const username = typeof usernameInput === 'string' ? usernameInput.trim().toLowerCase() : ''
  const password = typeof passwordInput === 'string' ? passwordInput : ''
  const db = getDb()
  const [row] = await db
    .select({ user: users, employeeStatus: employees.status })
    .from(users)
    .innerJoin(employees, eq(employees.id, users.employeeId))
    .where(eq(users.username, username))
    .limit(1)

  if (!row || !row.user.passwordHash) {
    dummyHash ??= hashPassword('dummy-password-for-timing')
    await verifyPassword(await dummyHash, password)
    return { ok: false, code: 'invalid_credentials' }
  }
  const user = row.user
  const now = new Date()
  if (user.lockedUntil && user.lockedUntil > now) return { ok: false, code: 'account_locked' }

  const valid = await verifyPassword(user.passwordHash!, password)
  if (!valid) {
    const failed = user.failedLoginCount + 1
    await db
      .update(users)
      .set({
        failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id))
    return { ok: false, code: failed >= MAX_FAILED_LOGINS ? 'account_locked' : 'invalid_credentials' }
  }
  // Suspended/pending accounts and inactive employees get the same generic answer.
  if (user.status !== 'active' || row.employeeStatus !== 'active') return { ok: false, code: 'invalid_credentials' }

  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id))
  const session = await createSession(user.id)
  return { ok: true, ...session, locale: user.locale, mustChangePassword: user.mustChangePassword }
}

/** Look up a setup link without consuming it (for rendering the setup page). */
export async function inspectInvite(token: string) {
  if (!token || token.length > 200) return null
  const [row] = await getDb()
    .select({ username: users.username, locale: users.locale, fullName: employees.fullName, displayNameEn: employees.displayNameEn })
    .from(accountInvites)
    .innerJoin(users, eq(users.id, accountInvites.userId))
    .innerJoin(employees, eq(employees.id, users.employeeId))
    .where(
      and(
        eq(accountInvites.tokenHash, sha256(token)),
        isNull(accountInvites.usedAt),
        isNull(accountInvites.revokedAt),
        gt(accountInvites.expiresAt, new Date()),
        eq(employees.status, 'active'),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Consume a setup link: set the password, activate the account, end other sessions. */
export async function completeSetup(token: string, passwordInput: unknown, localeInput: unknown) {
  const password = validateNewPassword(passwordInput)
  const locale = z.enum(['ar', 'en']).safeParse(localeInput)
  const passwordHash = await hashPassword(password)
  const db = getDb()
  const userId = await db.transaction(async (tx) => {
    const now = new Date()
    // Single-use: the conditional UPDATE claims the invite atomically.
    const [invite] = await tx
      .update(accountInvites)
      .set({ usedAt: now })
      .where(
        and(
          eq(accountInvites.tokenHash, sha256(token)),
          isNull(accountInvites.usedAt),
          isNull(accountInvites.revokedAt),
          gt(accountInvites.expiresAt, now),
        ),
      )
      .returning()
    if (!invite) throw new ValidationError('invite_invalid')
    const [user] = await tx.select().from(users).where(eq(users.id, invite.userId)).for('update')
    const [emp] = await tx.select({ status: employees.status }).from(employees).where(eq(employees.id, user!.employeeId))
    if (emp?.status !== 'active') throw new ValidationError('invite_invalid')
    await tx
      .update(users)
      .set({
        passwordHash,
        status: user!.status === 'suspended' ? 'suspended' : 'active',
        passwordChangedAt: now,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        ...(locale.success ? { locale: locale.data } : {}),
        updatedAt: now,
      })
      .where(eq(users.id, user!.id))
    await writeAudit(tx, { actorUserId: user!.id, action: 'account.setup_completed', entityType: 'user', entityId: user!.id })
    return user!.id
  })
  await deleteAllSessionsForUser(userId)
  return { userId }
}

export async function changePassword(actor: Actor, currentPassword: unknown, newPassword: unknown, keepToken: string) {
  const next = validateNewPassword(newPassword)
  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1)
  if (!user?.passwordHash || typeof currentPassword !== 'string' || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ValidationError('validation_failed', { currentPassword: 'password_wrong' })
  }
  if (await verifyPassword(user.passwordHash, next)) throw new ValidationError('validation_failed', { newPassword: 'password_same' })
  const passwordHash = await hashPassword(next)
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, passwordChangedAt: new Date(), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, actor.userId))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'account.password_changed', entityType: 'user', entityId: actor.userId })
  })
  await deleteAllSessionsForUser(actor.userId, keepToken)
}

export async function setLocale(actor: Actor, localeInput: unknown) {
  const locale = z.enum(['ar', 'en']).safeParse(localeInput)
  if (!locale.success) throw new ValidationError('validation_failed', { locale: 'invalid' })
  await getDb().update(users).set({ locale: locale.data, updatedAt: new Date() }).where(eq(users.id, actor.userId))
  return locale.data
}
