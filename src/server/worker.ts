import { sql } from 'drizzle-orm'
import { purgeExpiredSessions } from './auth/sessions'
import { getDb } from './db'
import { deliverPendingPushes } from './push'
import { createDueMessageNotifications, purgeOldNotifications } from './services/notifications'

/** Arbitrary constant: only one worker tick runs at a time, even with several workers. */
const WORKER_LOCK = 72_401_311

/**
 * One pass of the background worker: announce WhatsApp tasks that became due, then push all
 * pending notifications. Returns null when another worker holds the lock.
 */
export async function runWorkerTick(now = new Date()) {
  return getDb().transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(sql`SELECT pg_try_advisory_xact_lock(${WORKER_LOCK}) AS ok`).then((r) => r.rows)
    if (!lock?.ok) return null
    const announced = await createDueMessageNotifications(tx, now)
    const { sent } = await deliverPendingPushes(tx, now)
    return { announced, sent }
  })
}

/** Daily housekeeping. */
export async function runHousekeeping(now = new Date()) {
  await purgeOldNotifications(getDb(), now)
  await purgeExpiredSessions()
}

let started = false

/** Background loop inside the web server process (see src/instrumentation.ts). */
export function startInProcessWorker(intervalMs = 15_000) {
  if (started) return
  started = true
  let running = false
  let lastHousekeeping = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runWorkerTick()
      if (Date.now() - lastHousekeeping > 24 * 3600_000) {
        await runHousekeeping()
        lastHousekeeping = Date.now()
      }
    } catch (err) {
      console.error('In-app worker tick failed:', err instanceof Error ? err.message : 'unknown')
    } finally {
      running = false
    }
  }
  setInterval(tick, intervalMs).unref()
  console.log('In-app worker started.')
}
