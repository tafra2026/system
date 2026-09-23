import { DomainError } from './errors'

/** Spec §11: default margin 15 minutes, adjustable between 10 and 15. */
export const DEFAULT_BUFFER_MINUTES = 15
export const MIN_BUFFER_MINUTES = 10
export const MAX_BUFFER_MINUTES = 15

export type LegKind = 'dropoff' | 'pickup'

export function validateBuffer(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < MIN_BUFFER_MINUTES || minutes > MAX_BUFFER_MINUTES) {
    throw new DomainError('buffer_out_of_range', { min: MIN_BUFFER_MINUTES, max: MAX_BUFFER_MINUTES })
  }
  return minutes
}

export function validateTravelMinutes(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 300) throw new DomainError('travel_invalid')
  return minutes
}

/**
 * Planned times of a leg. Dropoff arrives at the visit start; pickup arrives at the visit
 * end. The driver leaves travel + buffer minutes earlier. These are ESTIMATES, not tracking.
 */
export function legTimes(input: { kind: LegKind; visitStart: Date; visitDurationMinutes: number; travelMinutes: number; bufferMinutes: number }) {
  const arriveAt = input.kind === 'dropoff' ? input.visitStart : new Date(input.visitStart.getTime() + input.visitDurationMinutes * 60_000)
  const departAt = new Date(arriveAt.getTime() - (validateTravelMinutes(input.travelMinutes) + validateBuffer(input.bufferMinutes)) * 60_000)
  return { departAt, arriveAt }
}

export interface DaysOff {
  /** 0 = Sunday … 6 = Saturday. */
  weekly: number[]
  /** Specific operational dates (YYYY-MM-DD). */
  dates: string[]
}

export function isDayOff(operationalDate: string, daysOff: DaysOff): boolean {
  const weekday = new Date(`${operationalDate}T12:00:00Z`).getUTCDay()
  return daysOff.weekly.includes(weekday) || daysOff.dates.includes(operationalDate)
}
