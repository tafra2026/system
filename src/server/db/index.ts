import 'server-only'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export type Database = NodePgDatabase<typeof schema>
/** A database handle or an open transaction. */
export type Executor = Parameters<Parameters<Database['transaction']>[0]>[0] | Database

const globalForDb = globalThis as unknown as { __pamperPool?: Pool; __pamperDb?: Database }

function createDb(): Database {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)')
  const pool = globalForDb.__pamperPool ?? new Pool({ connectionString: url, max: 10 })
  globalForDb.__pamperPool = pool
  return drizzle(pool, { schema })
}

/** Lazily created so that builds and tests without a database do not fail at import time. */
export function getDb(): Database {
  globalForDb.__pamperDb ??= createDb()
  return globalForDb.__pamperDb
}

export async function closeDb(): Promise<void> {
  await globalForDb.__pamperPool?.end()
  globalForDb.__pamperPool = undefined
  globalForDb.__pamperDb = undefined
}

export { schema }
