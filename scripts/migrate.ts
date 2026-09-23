import 'dotenv/config'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { closeDb, getDb } from '../src/server/db'

async function main() {
  const target = process.argv.includes('--test') ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
  if (!target) throw new Error('Database URL is not set (see .env.example)')
  process.env.DATABASE_URL = target
  await migrate(getDb(), { migrationsFolder: 'drizzle' })
  console.log('Migrations applied.')
  await closeDb()
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
