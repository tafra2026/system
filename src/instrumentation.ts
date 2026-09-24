/**
 * Runs once when the Next.js server starts. On hosts that allow only ONE Node process
 * (hosting panels), set RUN_WORKER_IN_APP=1 to run the background worker (3-hour WhatsApp
 * reminders, Web Push) inside the web server. With Docker the separate `worker` service is
 * used instead. A database advisory lock guarantees a single active worker either way.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.RUN_WORKER_IN_APP !== '1') return
  const { startInProcessWorker } = await import('./server/worker')
  startInProcessWorker()
}
