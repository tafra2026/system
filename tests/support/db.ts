import { sql } from 'drizzle-orm'
import { hashPassword } from '@/server/auth/crypto'
import { createSession } from '@/server/auth/sessions'
import type { Actor } from '@/server/authz/actor'
import { defaultLocaleForRole } from '@/server/authz/permissions'
import { getDb } from '@/server/db'
import { employees, users, type EmployeeRole } from '@/server/db/schema'

export function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? ''
  if (!url || url !== process.env.TEST_DATABASE_URL || !/test/.test(url)) {
    throw new Error('Integration tests require TEST_DATABASE_URL pointing at a *test* database.')
  }
}

export async function resetDb() {
  assertTestDatabase()
  // TRUNCATE is not blocked by the append-only row triggers; it is used only on the test DB.
  await getDb().execute(sql`TRUNCATE sessions, account_invites, audit_log, salary_records, users, employees, app_settings RESTART IDENTITY CASCADE`)
}

let counter = 0
const PASSWORD_HASH = hashPassword('correct-horse-battery')

/** Create an employee with an ACTIVE account and a session. */
export async function makeStaff(role: EmployeeRole, fullName = `${role}-${++counter}`) {
  const db = getDb()
  const [emp] = await db.insert(employees).values({ fullName, role }).returning()
  const [user] = await db
    .insert(users)
    .values({ employeeId: emp!.id, username: `u${++counter}${role.replace('_', '')}`.slice(0, 32), locale: defaultLocaleForRole(role), status: 'active', passwordHash: await PASSWORD_HASH })
    .returning()
  const session = await createSession(user!.id)
  const actor: Actor = { userId: user!.id, employeeId: emp!.id, role, locale: user!.locale, username: user!.username, displayName: fullName }
  return { employee: emp!, user: user!, actor, token: session.token, password: 'correct-horse-battery' }
}
