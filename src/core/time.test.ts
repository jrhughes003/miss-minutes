import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  compareLocalDate,
  dayOfWeek,
  daysBetween,
  endOfLocalDay,
  isLocalDate,
  isLocalTime,
  isValidZone,
  localDayLengthHours,
  offsetMinutes,
  resolveLocal,
  startOfLocalDay,
  toInstant,
  toLocalDate,
  toLocalDateTime,
  toLocalTime,
} from './time'

const TORONTO = 'America/Toronto'
const LONDON = 'Europe/London'
const LORD_HOWE = 'Australia/Lord_Howe' // DST shift of only 30 minutes

describe('validation', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isLocalDate('2026-02-28')).toBe(true)
    expect(isLocalDate('2028-02-29')).toBe(true) // leap year
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('2026-13-01')).toBe(false)
    expect(isLocalDate('2026-1-01')).toBe(false)
    expect(isLocalDate(20260101)).toBe(false)
  })

  it('accepts 24-hour times only', () => {
    expect(isLocalTime('00:00')).toBe(true)
    expect(isLocalTime('23:59')).toBe(true)
    expect(isLocalTime('24:00')).toBe(false)
    expect(isLocalTime('7:30')).toBe(false)
    expect(isLocalTime('12:60')).toBe(false)
  })

  it('recognizes IANA zones', () => {
    expect(isValidZone(TORONTO)).toBe(true)
    expect(isValidZone('Mars/Olympus_Mons')).toBe(false)
  })
})

describe('offsets', () => {
  it('knows Toronto is UTC-5 in winter and UTC-4 in summer', () => {
    expect(offsetMinutes(new Date('2026-01-15T12:00:00Z'), TORONTO)).toBe(-300)
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), TORONTO)).toBe(-240)
  })

  it('handles a 30-minute DST shift', () => {
    expect(offsetMinutes(new Date('2026-07-01T00:00:00Z'), LORD_HOWE)).toBe(630) // +10:30 standard
    expect(offsetMinutes(new Date('2026-01-01T00:00:00Z'), LORD_HOWE)).toBe(660) // +11:00 summer
  })
})

describe('resolveLocal: ordinary times', () => {
  it('converts a winter time in Toronto', () => {
    const r = resolveLocal('2026-01-15', '08:00', TORONTO)
    expect(r).toEqual({ instant: new Date('2026-01-15T13:00:00Z'), resolution: 'exact' })
  })

  it('converts a summer time in Toronto', () => {
    expect(toInstant('2026-07-15', '08:00', TORONTO)).toEqual(new Date('2026-07-15T12:00:00Z'))
  })

  it('handles times just before and after midnight', () => {
    expect(toInstant('2026-12-31', '23:59', TORONTO)).toEqual(new Date('2027-01-01T04:59:00Z'))
    expect(toInstant('2027-01-01', '00:00', TORONTO)).toEqual(new Date('2027-01-01T05:00:00Z'))
  })
})

describe('resolveLocal: spring forward (gap)', () => {
  // Toronto 2026-03-08: 02:00 EST jumps to 03:00 EDT, so 02:00–02:59 never happens.
  it('moves a time inside the gap forward by the gap length (RFC 5545)', () => {
    const r = resolveLocal('2026-03-08', '02:30', TORONTO)
    expect(r.resolution).toBe('gap')
    // 02:30 at the pre-gap offset (EST, -5) is 07:30Z, which reads as 03:30 EDT.
    expect(r.instant).toEqual(new Date('2026-03-08T07:30:00Z'))
    expect(toLocalDateTime(r.instant, TORONTO)).toBe('2026-03-08T03:30')
  })

  it('leaves times on either side of the gap alone', () => {
    expect(resolveLocal('2026-03-08', '01:59', TORONTO)).toEqual({
      instant: new Date('2026-03-08T06:59:00Z'),
      resolution: 'exact',
    })
    expect(resolveLocal('2026-03-08', '03:00', TORONTO)).toEqual({
      instant: new Date('2026-03-08T07:00:00Z'),
      resolution: 'exact',
    })
  })

  it('handles London, whose gap is at 01:00', () => {
    const r = resolveLocal('2026-03-29', '01:15', LONDON)
    expect(r.resolution).toBe('gap')
    expect(toLocalDateTime(r.instant, LONDON)).toBe('2026-03-29T02:15')
  })

  it('handles a 30-minute gap (Lord Howe, first Sunday of October)', () => {
    const r = resolveLocal('2026-10-04', '02:15', LORD_HOWE)
    expect(r.resolution).toBe('gap')
    expect(toLocalDateTime(r.instant, LORD_HOWE)).toBe('2026-10-04T02:45')
  })
})

describe('resolveLocal: fall back (overlap)', () => {
  // Toronto 2026-11-01: 02:00 EDT falls back to 01:00 EST, so 01:00–01:59 happens twice.
  it('picks the first occurrence of a repeated time', () => {
    const r = resolveLocal('2026-11-01', '01:30', TORONTO)
    expect(r.resolution).toBe('overlap')
    expect(r.instant).toEqual(new Date('2026-11-01T05:30:00Z')) // 01:30 EDT, not 06:30Z (EST)
  })

  it('treats the hour after the overlap as ordinary', () => {
    expect(resolveLocal('2026-11-01', '02:00', TORONTO)).toEqual({
      instant: new Date('2026-11-01T07:00:00Z'),
      resolution: 'exact',
    })
  })
})

describe('local days', () => {
  it('has 23 hours on spring-forward day and 25 on fall-back day', () => {
    expect(localDayLengthHours('2026-03-08', TORONTO)).toBe(23)
    expect(localDayLengthHours('2026-11-01', TORONTO)).toBe(25)
    expect(localDayLengthHours('2026-06-01', TORONTO)).toBe(24)
    expect(localDayLengthHours('2026-10-04', LORD_HOWE)).toBe(23.5)
  })

  it('makes days half-open, so an instant belongs to exactly one day', () => {
    const end = endOfLocalDay('2026-05-01', TORONTO)
    expect(end).toEqual(startOfLocalDay('2026-05-02', TORONTO))
    expect(toLocalDate(end, TORONTO)).toBe('2026-05-02')
    expect(toLocalDate(new Date(end.getTime() - 1), TORONTO)).toBe('2026-05-01')
  })
})

describe('calendar arithmetic', () => {
  it('adds days across month, year and DST boundaries without drift', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('clamps month-end dates', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15')
  })

  it('knows weekdays and day differences', () => {
    expect(dayOfWeek('2026-10-06')).toBe(2) // a Tuesday
    expect(daysBetween('2026-10-06', '2026-10-13')).toBe(7)
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14) // across spring forward
  })

  it('compares dates and converts a whole instant to wall-clock parts', () => {
    expect(compareLocalDate('2026-01-02', '2026-01-10')).toBe(-1)
    expect(compareLocalDate('2026-01-10', '2026-01-02')).toBe(1)
    expect(compareLocalDate('2026-01-02', '2026-01-02')).toBe(0)
    expect(toLocalTime(new Date('2026-07-01T03:05:00Z'), TORONTO)).toBe('23:05')
  })

  it('rejects malformed input', () => {
    expect(() => toInstant('2026-02-30', '10:00', TORONTO)).toThrow(/date/)
    expect(() => addDays('2026-02-30', 1)).toThrow()
    expect(() => toInstant('2026-01-01', '25:00', TORONTO)).toThrow()
  })
})

describe('properties', () => {
  // Any instant from 1990 to 2060, at minute resolution.
  const minuteInstant = fc
    .integer({ min: Date.UTC(1990, 0, 1) / 60_000, max: Date.UTC(2060, 0, 1) / 60_000 })
    .map((m) => new Date(m * 60_000))
  const zone = fc.constantFrom(TORONTO, LONDON, LORD_HOWE, 'UTC', 'Asia/Kolkata', 'America/St_Johns')

  it('reading an instant as wall time and converting back returns the same instant, or the first occurrence in an overlap', () => {
    fc.assert(
      fc.property(minuteInstant, zone, (instant, z) => {
        const local = toLocalDateTime(instant, z)
        const [date, time] = local.split('T') as [string, string]
        const r = resolveLocal(date, time, z)
        // The result never lands in a gap (the time really happened).
        expect(r.resolution).not.toBe('gap')
        if (r.resolution === 'exact') expect(r.instant).toEqual(instant)
        else {
          // In an overlap the result is the earlier of the two readings.
          expect(r.instant.getTime()).toBeLessThanOrEqual(instant.getTime())
          expect(toLocalDateTime(r.instant, z)).toBe(local)
        }
      }),
      { numRuns: 3000 },
    )
  })

  it('a resolved instant always reads back as the requested time, unless it was in a gap', () => {
    const date = fc
      .integer({ min: 0, max: 365 * 30 })
      .map((n) => addDays('2010-01-01', n))
    const time = fc
      .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
      .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    fc.assert(
      fc.property(date, time, zone, (d, t, z) => {
        const r = resolveLocal(d, t, z)
        const readBack = toLocalDateTime(r.instant, z)
        if (r.resolution === 'gap') {
          // Pushed forward by the gap length, so later on the same day.
          expect(readBack > `${d}T${t}`).toBe(true)
          expect(readBack.slice(0, 10)).toBe(d)
        } else {
          expect(readBack).toBe(`${d}T${t}`)
        }
      }),
      { numRuns: 3000 },
    )
  })
})
