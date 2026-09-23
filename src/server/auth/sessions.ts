import { and, eq, gt, lt } from 'drizzle-orm'
import { getDb } from '../db'
import { employees, sessions, users } from '../db/schema'
import type { Actor } from '../authz/actor'
import { newToken, sha256 } from './crypto'

export const SESSION_COOKIE = 'pm_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REFRESH_AFTER_MS = 60 * 60 * 1000

export function actorDisplayName(fullName: string, displayNameEn: string | null, locale: 'ar' | 'en'): string {
  return locale === 'en' && displayNameEn ? displayNameEn : fullName
}

/** Create a session and return the raw token for the cookie (only its hash is stored). */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await getDb().insert(sessions).values({ id: sha256(token), userId, expiresAt })
  return { token, expiresAt }
}

/**
 * Resolve a session token to an active actor, or null. Slides the expiry forward.
 * An account still on a temporary password (set by management) gets NO actor here, so it
 * cannot use any page, action or API; only the change-password screen passes
 * `allowPendingPasswordChange` to let the employee choose her own password first.
 */
export async function actorFromSessionToken(
  token: string | undefined | null,
  opts: { allowPendingPasswordChange?: boolean } = {},
): Promise<Actor | null> {
  if (!token || token.length > 200) return null
  const db = getDb()
  const id = sha256(token)
  const now = new Date()
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      username: users.username,
      locale: users.locale,
      userStatus: users.status,
      mustChangePassword: users.mustChangePassword,
      employeeId: employees.id,
      role: employees.role,
      employeeStatus: employees.status,
      fullName: employees.fullName,
      displayNameEn: employees.displayNameEn,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(employees, eq(employees.id, users.employeeId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1)
  if (!row || row.userStatus !== 'active' || row.employeeStatus !== 'active') return null
  if (row.mustChangePassword && !opts.allowPendingPasswordChange) return null

  if (now.getTime() - row.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id))
  }
  return {
    userId: row.userId,
    employeeId: row.employeeId,
    role: row.role,
    locale: row.locale,
    username: row.username,
    displayName: actorDisplayName(row.fullName, row.displayNameEn, row.locale),
  }
}

export async function deleteSession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, sha256(token)))
}

export async function deleteAllSessionsForUser(userId: string, exceptToken?: string): Promise<void> {
  const db = getDb()
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))
  const keep = exceptToken ? sha256(exceptToken) : null
  for (const r of rows) if (r.id !== keep) await db.delete(sessions).where(eq(sessions.id, r.id))
}

export async function purgeExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()))
}
