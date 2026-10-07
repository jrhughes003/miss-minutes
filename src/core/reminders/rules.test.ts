import { describe, expect, it } from 'vitest'
import { describeReminder, normalizeReminders, occurrenceOf, REMINDER_LIMITS } from './rules'
import type { ReminderRule } from './types'

const NOW = '2026-10-06T14:00:00.000Z'
const LATER = '2026-10-07T14:00:00.000Z'
let n = 0
const newId = () => `r${++n}`
const due = { date: '2026-10-08', time: '13:30' }

describe('normalizeReminders', () => {
  it('assigns ids and schedules new reminders from now', () => {
    n = 0
    expect(normalizeReminders([{ when: { kind: 'beforeDue', minutes: 15 }, phone: true }], due, [], NOW, newId)).toEqual([
      { id: 'r1', when: { kind: 'beforeDue', minutes: 15 }, phone: true, scheduledAt: NOW },
    ])
  })

  it('keeps an unchanged reminder’s id and schedule, but re-schedules a changed one', () => {
    const existing: ReminderRule[] = [
      { id: 'a', when: { kind: 'beforeDue', minutes: 15 }, phone: false, scheduledAt: NOW },
      { id: 'b', when: { kind: 'beforeDue', minutes: 60 }, phone: false, scheduledAt: NOW },
    ]
    const out = normalizeReminders(
      [
        { id: 'a', when: { kind: 'beforeDue', minutes: 15 } },
        { id: 'b', when: { kind: 'beforeDue', minutes: 30 } },
      ],
      due,
      existing,
      LATER,
      newId,
    )
    expect(out.map((r) => [r.id, r.scheduledAt])).toEqual([
      ['a', NOW],
      ['b', LATER],
    ])
  })

  it('drops exact duplicates', () => {
    const r = { when: { kind: 'beforeDue' as const, minutes: 5 } }
    expect(normalizeReminders([r, r], due, [], NOW, newId)).toHaveLength(1)
  })

  it('enforces Google Calendar’s limits so reminders can reach the phone', () => {
    const many = Array.from({ length: REMINDER_LIMITS.perTask + 1 }, (_, i) => ({ when: { kind: 'beforeDue' as const, minutes: i } }))
    expect(() => normalizeReminders(many, due, [], NOW, newId)).toThrow(/at most 5/)
    expect(() => normalizeReminders([{ when: { kind: 'beforeDue', minutes: 40_321 } }], due, [], NOW, newId)).toThrow(/4 weeks/)
    expect(() => normalizeReminders([{ when: { kind: 'beforeDue', minutes: -5 } }], due, [], NOW, newId)).toThrow()
  })

  it('rejects reminders that cannot fire', () => {
    expect(() => normalizeReminders([{ when: { kind: 'beforeDue', minutes: 0 } }], null, [], NOW, newId)).toThrow(/needs a due date/)
    expect(() => normalizeReminders([{ when: { kind: 'at', date: '2026-02-30', time: '08:00' } }], null, [], NOW, newId)).toThrow(/real date/)
    expect(() => normalizeReminders([{ when: { kind: 'later' } as never }], null, [], NOW, newId)).toThrow(/Unknown/)
    expect(() => normalizeReminders([null as never], null, [], NOW, newId)).toThrow(/malformed/)
    expect(() => normalizeReminders('soon', null, [], NOW, newId)).toThrow(/list/)
  })

  it('allows fixed-time reminders on undated tasks', () => {
    expect(normalizeReminders([{ when: { kind: 'at', date: '2026-10-09', time: '08:00' } }], null, [], NOW, newId)).toHaveLength(1)
  })
})

describe('occurrenceOf', () => {
  const rule = (when: ReminderRule['when']): ReminderRule => ({ id: 'x', when, phone: false, scheduledAt: NOW })

  it('counts back from a timed due date', () => {
    expect(occurrenceOf(rule({ kind: 'beforeDue', minutes: 15 }), due, 'America/Toronto')).toEqual({
      local: '2026-10-08T13:15',
      instant: new Date('2026-10-08T17:15:00Z'),
    })
  })

  it('counts back from the all-day reminder time for an all-day task', () => {
    expect(occurrenceOf(rule({ kind: 'beforeDue', minutes: 0 }), { date: '2026-10-08', time: null }, 'America/Toronto')?.local).toBe('2026-10-08T09:00')
    expect(occurrenceOf(rule({ kind: 'beforeDue', minutes: 1440 }), { date: '2026-10-08', time: null }, 'America/Toronto', '07:30')?.local).toBe('2026-10-07T07:30')
  })

  it('does real-time arithmetic across a DST change', () => {
    // Due 03:10 on spring-forward day; 30 minutes earlier is 01:40 EST, not 02:40 (which never happens).
    expect(occurrenceOf(rule({ kind: 'beforeDue', minutes: 30 }), { date: '2026-03-08', time: '03:10' }, 'America/Toronto')?.local).toBe('2026-03-08T01:40')
  })

  it('handles fixed-time reminders and missing due dates', () => {
    expect(occurrenceOf(rule({ kind: 'at', date: '2026-10-09', time: '08:00' }), null, 'America/Toronto')?.local).toBe('2026-10-09T08:00')
    expect(occurrenceOf(rule({ kind: 'beforeDue', minutes: 0 }), null, 'America/Toronto')).toBeNull()
  })
})

describe('describeReminder', () => {
  it('describes common offsets', () => {
    expect(describeReminder({ when: { kind: 'beforeDue', minutes: 0 } }, true)).toBe('At due time')
    expect(describeReminder({ when: { kind: 'beforeDue', minutes: 0 } }, false)).toBe('On the day')
    expect(describeReminder({ when: { kind: 'beforeDue', minutes: 15 } }, true)).toBe('15 min before')
    expect(describeReminder({ when: { kind: 'beforeDue', minutes: 120 } }, true)).toBe('2 hours before')
    expect(describeReminder({ when: { kind: 'beforeDue', minutes: 1440 } }, true)).toBe('1 day before')
    expect(describeReminder({ when: { kind: 'at', date: '2026-10-09', time: '08:00' } }, false)).toBe('2026-10-09 08:00')
  })
})
