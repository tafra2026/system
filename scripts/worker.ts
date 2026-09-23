import 'dotenv/config'
import { closeDb } from '../src/server/db'
import { pushConfigured } from '../src/server/push'
import { runHousekeeping, runWorkerTick } from '../src/server/worker'

/**
 * Background worker (runs next to the app, see docker-compose.yml):
 * every 15 seconds it announces due WhatsApp tasks (e.g. the 3-hour reminder) and sends
 * Web Push notifications. Reminders therefore never depend on a page being open.
 * Logs contain counts only — never names, phones or message text.
 */
const INTERVAL_MS = 15_000
let stopping = false

async function main() {
  console.log(`Worker started. Web Push ${pushConfigured() ? 'enabled' : 'not configured (in-app notifications only)'}.`)
  let lastHousekeeping = 0
  while (!stopping) {
    try {
      const r = await runWorkerTick()
      if (r && (r.announced || r.sent)) console.log(`tick: ${r.announced} due-message notifications, ${r.sent} pushed`)
      if (Date.now() - lastHousekeeping > 24 * 3600_000) {
        await runHousekeeping()
        lastHousekeeping = Date.now()
      }
    } catch (err) {
      console.error('Worker tick failed:', err instanceof Error ? err.message : 'unknown')
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
  await closeDb()
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (stopping = true))
main()
