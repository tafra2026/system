/**
 * Per-client sign-in throttle, in addition to the per-account lock (5 failures → 15 min).
 * Limits password guessing across many usernames from one address without affecting normal
 * use: 20 failed attempts per 15 minutes per client address. In-memory (one app process);
 * the per-account lock in the database still applies across processes.
 */
const WINDOW_MS = 15 * 60_000
const MAX_FAILURES = 20
const failures = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length) failures.set(key, list)
  else failures.delete(key)
  return list
}

export function isThrottled(key: string, now = Date.now()): boolean {
  return recent(key, now).length >= MAX_FAILURES
}

export function recordFailure(key: string, now = Date.now()) {
  const list = recent(key, now)
  list.push(now)
  failures.set(key, list)
  if (failures.size > 10_000) failures.delete(failures.keys().next().value!)
}

export function clearFailures(key: string) {
  failures.delete(key)
}

/** First address in X-Forwarded-For (set by the hosting proxy), else the direct address. */
export function clientKey(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown'
}
