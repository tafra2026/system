import fs from 'node:fs'
import path from 'node:path'
import { type NextRequest } from 'next/server'
import { sql } from 'drizzle-orm'
import { authorize } from '@/server/authz/actor'
import { ForbiddenError } from '@/server/authz/errors'
import { getDb } from '@/server/db'
import { customerDocuments, orders, paymentLinks, tripLegs, visits } from '@/server/db/schema'
import { json, withActor } from '@/server/http'
import { lastMigrationStatus, migrateOnStart } from '@/server/migrate-on-start'

export const dynamic = 'force-dynamic'

/** Database error text without connection details. */
function describe(err: unknown): string {
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : null
  const msg = cause instanceof Error ? cause.message : err instanceof Error ? err.message : 'unknown error'
  return msg.replace(/postgres(ql)?:\/\/\S+/gi, '[database url]').slice(0, 300)
}

/**
 * Owner diagnostics after a deploy: are the database updates applied, and do the main tables
 * answer? Shows error text only (never connection strings, keys or customer data).
 * `?apply=1` re-runs the database updates (safe to repeat); refused from other websites.
 */
export const GET = withActor(async (req: NextRequest, actor) => {
  authorize(actor, 'settings.manage')
  let applied: string | null = null
  if (req.nextUrl.searchParams.get('apply') === '1') {
    if (req.headers.get('sec-fetch-site') === 'cross-site') throw new ForbiddenError()
    await migrateOnStart()
    applied = 'attempted'
  }
  const db = getDb()
  const folder = path.join(process.cwd(), 'drizzle')
  let expected: number | null = null
  let latestFile: string | null = null
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    expected = journal.entries.length
    latestFile = journal.entries.at(-1)?.tag ?? null
  } catch {
    // reported below as expected = null
  }
  let appliedCount: number | string
  try {
    const r = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`)
    appliedCount = Number(r.rows[0]?.n ?? 0)
  } catch (err) {
    appliedCount = describe(err)
  }
  const checks: Record<string, string> = {}
  const probes = {
    orders: () => db.select().from(orders).limit(1),
    visits: () => db.select().from(visits).limit(1),
    trip_legs: () => db.select().from(tripLegs).limit(1),
    payment_links: () => db.select().from(paymentLinks).limit(1),
    customer_documents: () => db.select().from(customerDocuments).limit(1),
    search_function: () => db.execute(sql`SELECT pm_normalize_ar('أ')`),
  }
  for (const [name, run] of Object.entries(probes)) {
    try {
      await run()
      checks[name] = 'ok'
    } catch (err) {
      checks[name] = describe(err)
    }
  }
  return json({
    ok: expected !== null && appliedCount === expected && Object.values(checks).every((v) => v === 'ok'),
    migrations: { expected, applied: appliedCount, latestFile, folderFound: expected !== null, cwd: process.cwd() },
    lastUpdateOnStart: lastMigrationStatus(),
    applyNow: applied,
    checks,
    node: process.version,
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      APP_BASE_URL: !!process.env.APP_BASE_URL,
      RUN_WORKER_IN_APP: process.env.RUN_WORKER_IN_APP === '1',
      MIGRATE_ON_START: process.env.MIGRATE_ON_START !== '0',
    },
  })
})
