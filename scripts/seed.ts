import 'dotenv/config'
import { count } from 'drizzle-orm'
import { riyadhMonthStart } from '../src/domain/operational-day'
import { writeAudit } from '../src/server/audit'
import { closeDb, getDb } from '../src/server/db'
import { employees, salaryRecords } from '../src/server/db/schema'
import { INITIAL_STAFF } from '../src/server/seed-data'
import { seedCatalog } from '../src/server/seed-catalog'

/** Idempotent: seeds the catalog and staff only when empty. Creates NO login accounts. */
async function main() {
  const db = getDb()
  const catalogCreated = await db.transaction((tx) => seedCatalog(tx))
  console.log(catalogCreated ? 'Seeded the service & package catalog.' : 'Catalog already exists — unchanged.')

  const [row] = await db.select({ value: count() }).from(employees)
  const value = row?.value ?? 0
  if (value > 0) {
    console.log(`Staff skipped: ${value} employees already exist.`)
    return
  }
  const effectiveFrom = process.argv.find((a) => a.startsWith('--salary-from='))?.split('=')[1] ?? riyadhMonthStart()
  await db.transaction(async (tx) => {
    for (const s of INITIAL_STAFF) {
      const [emp] = await tx.insert(employees).values({ fullName: s.fullName, role: s.role }).returning()
      if (s.monthlySalarySar != null) {
        await tx.insert(salaryRecords).values({ employeeId: emp!.id, monthlySalaryHalalas: s.monthlySalarySar * 100, effectiveFrom, reason: null })
      }
    }
    await writeAudit(tx, { actorUserId: null, action: 'system.seed', entityType: 'system', entityId: 'initial_staff', after: { employees: INITIAL_STAFF.length, salaryEffectiveFrom: effectiveFrom } })
  })
  const total = INITIAL_STAFF.reduce((a, s) => a + (s.monthlySalarySar ?? 0), 0)
  console.log(`Seeded ${INITIAL_STAFF.length} employees (salaries effective ${effectiveFrom}, total ${total} SAR/month). No accounts created.`)
}

main()
  .catch((err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
