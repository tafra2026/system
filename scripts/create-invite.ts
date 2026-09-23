import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../src/server/db'
import { employees, users } from '../src/server/db/schema'
import { createAccount, INVITE_TTL_HOURS, reissueInvite, setupUrl } from '../src/server/services/accounts'

/**
 * Server-side bootstrap: issue a one-time account setup link without signing in.
 * Needs direct server access, so it is how the FIRST owner account is created.
 *
 *   npm run owner:invite -- --role=owner --username=doha
 *   npm run owner:invite -- --employee=<employee-uuid> --username=alaa
 */
function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

async function main() {
  const db = getDb()
  const employeeId = arg('employee')
  const role = arg('role')
  const username = arg('username')
  let candidates = employeeId
    ? await db.select().from(employees).where(eq(employees.id, employeeId))
    : role
      ? await db.select().from(employees).where(eq(employees.role, role as 'owner'))
      : []
  candidates = candidates.filter((e) => e.status === 'active')
  if (candidates.length !== 1) {
    console.error(`Expected exactly one active employee, found ${candidates.length}. Use --employee=<id>.`)
    for (const c of candidates) console.error(`  ${c.id}  ${c.role}  ${c.fullName}`)
    process.exitCode = 1
    return
  }
  const emp = candidates[0]!
  const [existing] = await db.select().from(users).where(eq(users.employeeId, emp.id))
  const invite = existing ? await reissueInvite(null, existing.id) : await createAccount(null, emp.id, username)
  console.log(`Setup link for ${emp.fullName} (valid ${INVITE_TTL_HOURS} hours, single use):`)
  console.log(setupUrl(invite.token))
}


main()
  .catch((err) => {
    console.error('Failed:', err instanceof Error ? `${err.message} ${JSON.stringify((err as { fieldErrors?: unknown }).fieldErrors ?? '')}` : err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
