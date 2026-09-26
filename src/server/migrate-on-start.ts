import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

/** Any fixed number; only processes of this app take this lock. */
const MIGRATION_LOCK = 7_391_004

/**
 * Apply pending database updates when the web server starts. Some hosting panels start the
 * app with their own launcher (not `npm start`), so the start script alone cannot be relied on.
 * Several processes may start at once: an advisory lock makes them take turns, and a process
 * that gets the lock after another one finished finds nothing left to apply.
 * Updates are additive and all-or-nothing (one transaction). A failure is logged without
 * connection details and the server keeps running on the unchanged database.
 */
export async function migrateOnStart(): Promise<void> {
  const url = process.env.DATABASE_URL
  const folder = path.join(process.cwd(), 'drizzle')
  if (!url) return console.error('Database update skipped: DATABASE_URL is not set.')
  if (!fs.existsSync(path.join(folder, 'meta', '_journal.json'))) return console.error('Database update skipped: the drizzle folder was not found.')
  const client = new Client({ connectionString: url })
  try {
    await client.connect()
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    try {
      await migrate(drizzle(client), { migrationsFolder: folder })
      console.log('Migrations applied.')
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {})
    }
  } catch (err) {
    console.error('Database update failed:', err instanceof Error ? err.message : 'unknown error')
  } finally {
    await client.end().catch(() => {})
  }
}
