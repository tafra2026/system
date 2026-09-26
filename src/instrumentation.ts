/**
 * Runs once when the Next.js server starts, before it handles requests.
 *
 * 1. Applies pending database updates (hosting panels may start the app with their own
 *    launcher instead of `npm start`). Set MIGRATE_ON_START=0 to turn this off.
 * 2. On hosts that allow only ONE Node process (hosting panels), RUN_WORKER_IN_APP=1 runs the
 *    background worker (3-hour WhatsApp reminders, Web Push) inside the web server. With Docker
 *    the separate `worker` service is used instead. A database advisory lock guarantees a
 *    single active worker either way.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.MIGRATE_ON_START !== '0') {
    const { migrateOnStart } = await import('./server/migrate-on-start')
    await migrateOnStart()
  }
  if (process.env.RUN_WORKER_IN_APP !== '1') return
  const { startInProcessWorker } = await import('./server/worker')
  startInProcessWorker()
}
