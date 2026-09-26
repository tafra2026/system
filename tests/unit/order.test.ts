import { describe, expect, it } from 'vitest'
import { formatOrderReference, packageSessionBalance, parseCoordinates, suggestedVisitMinutes } from '@/domain/order'

describe('visit duration suggestion', () => {
  it('parallel specialists: the busiest one sets the suggestion', () => {
    expect(suggestedVisitMinutes([{ specialistId: 'a', taskMinutes: 60 }, { specialistId: 'b', taskMinutes: 60 }, { specialistId: 'a', taskMinutes: 30 }])).toBe(90)
  })
  it('package declared duration is never reduced by component math', () => {
    // Complete relaxation: components 60+30+30 with 2 specialists could "fit" in 60, but 140 is declared.
    expect(suggestedVisitMinutes([], [140])).toBe(140)
    expect(suggestedVisitMinutes([{ specialistId: 'a', taskMinutes: 30 }], [120])).toBe(120)
  })
})

describe('package session balance', () => {
  it('total / used / scheduled / remaining', () => {
    expect(packageSessionBalance(2, ['completed', 'unscheduled'])).toEqual({ total: 2, used: 1, scheduled: 0, pendingReview: 0, cancelled: 0, remaining: 1 })
    expect(packageSessionBalance(2, ['completed', 'scheduled'])).toEqual({ total: 2, used: 1, scheduled: 1, pendingReview: 0, cancelled: 0, remaining: 0 })
  })
})

describe('references and coordinates', () => {
  it('formats references', () => {
    expect(formatOrderReference('2026-09-23', 12)).toBe('PM-2609-0012')
  })
  it('parses coordinates and maps links', () => {
    expect(parseCoordinates('21.5433, 39.1728')).toEqual({ latitude: 21.5433, longitude: 39.1728 })
    // The map view centre is not a pin (D74).
    expect(parseCoordinates('https://www.google.com/maps/@21.5433,39.1728,17z')).toBeNull()
    expect(parseCoordinates('https://www.google.com/maps/place/X/@21.4,39.1,17z/data=!3d21.5433!4d39.1728')).toEqual({ latitude: 21.5433, longitude: 39.1728 })
    expect(parseCoordinates('https://maps.google.com/?q=21.5,39.2')).toEqual({ latitude: 21.5, longitude: 39.2 })
    expect(parseCoordinates('https://www.google.com/maps/place/x/data=!3d21.61!4d39.11')).toEqual({ latitude: 21.61, longitude: 39.11 })
    expect(parseCoordinates('https://maps.app.goo.gl/abc')).toBeNull()
    expect(parseCoordinates('200, 10')).toBeNull()
  })
})
