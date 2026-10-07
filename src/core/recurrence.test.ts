import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { describeRecurrence, nextDue, previewOccurrences, validateRecurrence, type Due, type Recurrence } from './recurrence'
import { addDays, dayOfWeek } from './time'

const rule = (rrule: string): Recurrence => ({ kind: 'rule', rrule })
const at = (date: string, time: string | null = null): Due => ({ date, time })
// Completing on the due date itself, the ordinary case.
const onTime = (date: string) => ({ today: date, completedOn: date })

describe('validateRecurrence', () => {
  it('accepts the presets and common rules', () => {
    for (const r of ['FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'freq=yearly', 'FREQ=WEEKLY;UNTIL=20271231T000000Z']) {
      expect(validateRecurrence(rule(r)), r).toBeNull()
    }
  })

  it('rejects what the app does not support, with a reason', () => {
    expect(validateRecurrence(rule('FREQ=HOURLY'))).toMatch(/daily, weekly/)
    expect(validateRecurrence(rule('FREQ=DAILY;COUNT=5'))).toMatch(/UNTIL/)
    expect(validateRecurrence(rule('DTSTART=20260101T000000Z;FREQ=DAILY'))).toMatch(/DTSTART/)
    expect(validateRecurrence(rule('BYDAY=MO'))).toMatch(/FREQ/)
    expect(validateRecurrence(rule('FREQ=WEEKLY;BYDAY=XX'))).toMatch(/Invalid/)
  })

  it('checks after-completion intervals', () => {
    expect(validateRecurrence({ kind: 'afterCompletion', every: 3, unit: 'day' })).toBeNull()
    expect(validateRecurrence({ kind: 'afterCompletion', every: 0, unit: 'day' })).not.toBeNull()
    expect(validateRecurrence({ kind: 'afterCompletion', every: 1.5, unit: 'week' })).not.toBeNull()
  })
})

describe('nextDue: rule-based', () => {
  it('moves a daily task to tomorrow, keeping its time', () => {
    expect(nextDue(at('2026-10-06', '08:00'), rule('FREQ=DAILY'), onTime('2026-10-06'))).toEqual(at('2026-10-07', '08:00'))
  })

  it('keeps all-day tasks all-day', () => {
    expect(nextDue(at('2026-10-06'), rule('FREQ=DAILY'), onTime('2026-10-06'))).toEqual(at('2026-10-07'))
  })

  it('skips weekends for a weekday rule', () => {
    // 2026-10-09 is a Friday.
    expect(nextDue(at('2026-10-09'), rule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), onTime('2026-10-09'))).toEqual(at('2026-10-12'))
  })

  it('handles "second Tuesday of the month"', () => {
    // 2026-10-13 is the 2nd Tuesday of October; November's is the 10th.
    expect(nextDue(at('2026-10-13'), rule('FREQ=MONTHLY;BYDAY=2TU'), onTime('2026-10-13'))).toEqual(at('2026-11-10'))
  })

  it('handles "last day of the month"', () => {
    expect(nextDue(at('2026-01-31'), rule('FREQ=MONTHLY;BYMONTHDAY=-1'), onTime('2026-01-31'))).toEqual(at('2026-02-28'))
  })

  it('keeps an 08:00 task at 08:00 across the spring-forward weekend', () => {
    // Wall-clock times don't move with DST: the conversion to an instant happens later.
    expect(nextDue(at('2026-03-07', '08:00'), rule('FREQ=DAILY'), onTime('2026-03-07'))).toEqual(at('2026-03-08', '08:00'))
  })

  it('skips ahead to today when an overdue task is finally done, without creating a backlog', () => {
    // A daily task last due a week ago, done today (Oct 6): next is today, not Sep 30.
    expect(nextDue(at('2026-09-29', '08:00'), rule('FREQ=DAILY'), onTime('2026-10-06'))).toEqual(at('2026-10-06', '08:00'))
  })

  it('keeps the cadence of an every-other-week rule when skipping ahead', () => {
    // Every 2 weeks from Tue Sep 1: Sep 15, 29, Oct 13... Done on Oct 6 → Oct 13, not Oct 6.
    const next = nextDue(at('2026-09-01'), rule('FREQ=WEEKLY;INTERVAL=2'), onTime('2026-10-06'))
    expect(next).toEqual(at('2026-10-13'))
  })

  it('returns null when the series has ended', () => {
    expect(nextDue(at('2026-10-06'), rule('FREQ=DAILY;UNTIL=20261006T235959Z'), onTime('2026-10-06'))).toBeNull()
  })

  it('throws on an invalid rule rather than guessing', () => {
    expect(() => nextDue(at('2026-10-06'), rule('FREQ=HOURLY'), onTime('2026-10-06'))).toThrow()
  })
})

describe('nextDue: after completion', () => {
  it('counts from the completion date, not the due date', () => {
    const r: Recurrence = { kind: 'afterCompletion', every: 3, unit: 'day' }
    expect(nextDue(at('2026-10-01', '09:00'), r, { today: '2026-10-06', completedOn: '2026-10-06' })).toEqual(at('2026-10-09', '09:00'))
  })

  it('supports weeks and clamped months', () => {
    expect(nextDue(at('2026-01-31'), { kind: 'afterCompletion', every: 2, unit: 'week' }, onTime('2026-01-31'))).toEqual(at('2026-02-14'))
    expect(nextDue(at('2026-01-31'), { kind: 'afterCompletion', every: 1, unit: 'month' }, onTime('2026-01-31'))).toEqual(at('2026-02-28'))
  })
})

describe('previewOccurrences and describeRecurrence', () => {
  it('lists upcoming occurrences', () => {
    expect(previewOccurrences(at('2026-10-05', '07:00'), 'FREQ=WEEKLY;BYDAY=MO,TH', 4)).toEqual([
      at('2026-10-05', '07:00'),
      at('2026-10-08', '07:00'),
      at('2026-10-12', '07:00'),
      at('2026-10-15', '07:00'),
    ])
  })

  it('describes rules in English', () => {
    expect(describeRecurrence(rule('FREQ=WEEKLY;BYDAY=TU'))).toBe('every week on Tuesday')
    expect(describeRecurrence({ kind: 'afterCompletion', every: 1, unit: 'day' })).toBe('1 day after completion')
    expect(describeRecurrence({ kind: 'afterCompletion', every: 3, unit: 'week' })).toBe('3 weeks after completion')
  })
})

describe('properties', () => {
  const start = fc.integer({ min: 0, max: 3650 }).map((n) => addDays('2024-01-01', n))
  const lateness = fc.integer({ min: 0, max: 60 })

  it('the next due date is always after the current one and never before today', () => {
    const rules = fc.constantFrom('FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=WEEKLY;INTERVAL=2', 'FREQ=MONTHLY;BYDAY=2TU', 'FREQ=MONTHLY;BYMONTHDAY=-1', 'FREQ=YEARLY')
    fc.assert(
      fc.property(start, lateness, rules, (due, late, rr) => {
        const today = addDays(due, late)
        const next = nextDue(at(due), rule(rr), { today, completedOn: today })!
        expect(next.date > due).toBe(true)
        expect(next.date >= today).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it('a weekday rule never lands on a weekend', () => {
    fc.assert(
      fc.property(start, lateness, (due, late) => {
        const today = addDays(due, late)
        const next = nextDue(at(due), rule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), { today, completedOn: today })!
        expect([1, 2, 3, 4, 5]).toContain(dayOfWeek(next.date))
      }),
      { numRuns: 500 },
    )
  })
})
