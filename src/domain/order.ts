/**
 * Pure order/visit helpers (spec §6, §8).
 */

export interface TaskForDuration {
  specialistId: string | null
  taskMinutes: number
}

/**
 * SUGGESTED duration for a visit made of standalone services: the busiest specialist's
 * total (tasks of different specialists run in parallel; unassigned tasks count as one
 * extra person). Staff confirm or change it — the stored visit duration is the approved one.
 * Packages always use their declared visit duration instead (never derived from components).
 */
export function suggestedVisitMinutes(tasks: readonly TaskForDuration[], declaredPackageMinutes: readonly number[] = []): number {
  const perSpecialist = new Map<string, number>()
  for (const t of tasks) {
    const key = t.specialistId ?? '__unassigned__'
    perSpecialist.set(key, (perSpecialist.get(key) ?? 0) + t.taskMinutes)
  }
  const fromTasks = perSpecialist.size ? Math.max(...perSpecialist.values()) : 0
  return Math.max(fromTasks, ...declaredPackageMinutes, 0)
}

export type SessionState = 'unscheduled' | 'scheduled' | 'completed' | 'pending_review'

export interface SessionBalance {
  total: number
  /** Sessions executed (visit completed). */
  used: number
  /** Sessions booked for a date but not executed yet. */
  scheduled: number
  /** Sessions still to be booked (total − used − scheduled). */
  remaining: number
  /** Sessions whose visit could not be executed and awaits management review. */
  pendingReview: number
}

/** Session balance of a multi-visit package. Each session maps to exactly one visit. */
export function packageSessionBalance(total: number, sessionStates: readonly SessionState[]): SessionBalance {
  const used = sessionStates.filter((s) => s === 'completed').length
  const scheduled = sessionStates.filter((s) => s === 'scheduled').length
  const pendingReview = sessionStates.filter((s) => s === 'pending_review').length
  return { total, used, scheduled, pendingReview, remaining: Math.max(0, total - used - scheduled - pendingReview) }
}

/** Human-friendly unique reference: PM-YYMM-NNNN (sequence is global, never reused). */
export function formatOrderReference(riyadhDate: string, sequence: number): string {
  const yymm = riyadhDate.slice(2, 4) + riyadhDate.slice(5, 7)
  return `PM-${yymm}-${String(sequence).padStart(4, '0')}`
}

/**
 * Parse coordinates from "21.5433, 39.1728" or a Google Maps link
 * (…/@21.5433,39.1728,17z, …?q=21.5433,39.1728, …!3d21.5433!4d39.1728).
 */
export function parseCoordinates(input: string | null | undefined): { latitude: number; longitude: number } | null {
  if (!input) return null
  const text = decodeURIComponent(input.trim())
  const patterns = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const latitude = Number(m[1])
      const longitude = Number(m[2])
      if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude }
    }
  }
  return null
}

export function mapsLink(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
}

/** Google Maps directions to a point (opens the Maps app on phones). */
export function directionsLink(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
}
