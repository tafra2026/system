import 'dotenv/config'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../src/server/db'
import { employees, users } from '../src/server/db/schema'
import { createAccountWithPassword, setPasswordByManagement } from '../src/server/services/accounts'

/**
 * Server-side: create a login account with a username and password (typically the FIRST
 * owner account right after deployment), or set a new password if the account exists
 * (e.g. the owner forgot hers). The password is typed at a hidden prompt — never passed
 * on the command line, so it does not end up in the shell history or process list.
 *
 *   npm run account:create -- --role=owner --username=doha
 *   npm run account:create -- --employee=<employee-uuid> --username=hamdy
 */
function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

/** One readline for all prompts; typed characters are not echoed. Works with a terminal or piped input. */
function hiddenPrompter() {
  let muted = false
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk)
      cb()
    },
  })
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY ?? false })
  const lines: string[] = []
  const waiting: ((line: string) => void)[] = []
  rl.on('line', (line) => (waiting.length ? waiting.shift()!(line) : lines.push(line)))
  rl.on('close', () => waiting.splice(0).forEach((w) => w('')))
  const ask = (question: string) => {
    muted = false
    process.stdout.write(question)
    muted = true
    return new Promise<string>((resolve) => {
      const done = (line: string) => {
        process.stdout.write('\n')
        resolve(line)
      }
      if (lines.length) done(lines.shift()!)
      else waiting.push(done)
    })
  }
  return { ask, close: () => rl.close() }
}

async function main() {
  const db = getDb()
  const employeeId = arg('employee')
  const role = arg('role')
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
  if (!existing && !arg('username')) {
    console.error('Pass --username=<login name> for a new account.')
    process.exitCode = 1
    return
  }
  const prompt = hiddenPrompter()
  const password = await prompt.ask(`Password for ${emp.fullName} (min 10 characters): `)
  const repeat = await prompt.ask('Repeat the password: ')
  prompt.close()
  if (password !== repeat) {
    console.error('The passwords do not match. Nothing was changed.')
    process.exitCode = 1
    return
  }
  if (existing) {
    await setPasswordByManagement(null, existing.id, password, false)
    console.log(`New password set for "${existing.username}". Other sessions were signed out.`)
  } else {
    await createAccountWithPassword(null, emp.id, arg('username'), password, false)
    console.log(`Account created for ${emp.fullName}. Sign in with username "${arg('username')!.toLowerCase()}".`)
  }
}

main()
  .catch((err) => {
    console.error('Failed:', err instanceof Error ? `${err.message} ${JSON.stringify((err as { fieldErrors?: unknown }).fieldErrors ?? '')}` : err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
