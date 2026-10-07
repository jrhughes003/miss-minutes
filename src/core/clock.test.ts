import { describe, expect, it } from 'vitest'
import { FakeClock, HOUR, systemClock } from './clock'

describe('FakeClock', () => {
  it('only moves when told to', () => {
    const c = new FakeClock('2026-10-06T12:00:00Z', 'UTC')
    expect(c.now().toISOString()).toBe('2026-10-06T12:00:00.000Z')
    c.advance(HOUR)
    expect(c.now().toISOString()).toBe('2026-10-06T13:00:00.000Z')
    c.set('2027-01-01T00:00:00Z')
    expect(c.now().getUTCFullYear()).toBe(2027)
    c.setZone('Europe/London')
    expect(c.zone()).toBe('Europe/London')
  })

  it('rejects an invalid start rather than silently running at NaN', () => {
    expect(() => new FakeClock('not a date')).toThrow(/invalid start/)
  })
})

describe('systemClock', () => {
  it('reports a real instant and an IANA zone', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000)
    expect(systemClock.zone()).toMatch(/\S/)
  })
})
