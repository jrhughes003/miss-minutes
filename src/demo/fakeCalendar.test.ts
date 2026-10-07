import { describe, expect, it } from 'vitest'
import { addDays, toLocalDateTime } from '../core/time'
import { buildToday } from '../core/today'
import { fakeEventsBetween, generateFakeCalendar } from './fakeCalendar'

const ZONE = 'America/Toronto'
const TODAY = '2026-10-07' // a Wednesday

describe('generateFakeCalendar', () => {
  it('is deterministic for the same seed, and varies with the seed', () => {
    expect(generateFakeCalendar(TODAY, ZONE)).toEqual(generateFakeCalendar(TODAY, ZONE))
    expect(generateFakeCalendar(TODAY, ZONE, { seed: 7 })).not.toEqual(generateFakeCalendar(TODAY, ZONE, { seed: 8 }))
  })

  it('never produces an event that ends before it starts', () => {
    for (const e of generateFakeCalendar(TODAY, ZONE)) expect(e.end > e.start, e.id).toBe(true)
  })

  it('cancels and moves one instance of the recurring standup this week', () => {
    const events = generateFakeCalendar(TODAY, ZONE)
    // Mon Oct 5 – Fri Oct 9: Wednesday cancelled, Thursday moved to 10:30.
    const week = ['05', '06', '07', '08', '09'].map((d) => `standup-2026-10-${d}`)
    const standups = events.filter((e) => week.includes(e.id))
    expect(standups.map((e) => e.id)).toEqual(['standup-2026-10-05', 'standup-2026-10-06', 'standup-2026-10-08', 'standup-2026-10-09'])
    const moved = standups.find((e) => e.id === 'standup-2026-10-08')!
    expect(moved.title).toBe('Standup (moved)')
    expect(toLocalDateTime(new Date(moved.start), ZONE)).toBe('2026-10-08T10:30')
  })

  it('includes overlapping events, a midnight-crossing event and exclusive-end all-day events', () => {
    const events = generateFakeCalendar(TODAY, ZONE)
    const byId = new Map(events.map((e) => [e.id, e]))
    const a = byId.get('overlap-a')!
    const b = byId.get('overlap-b')!
    expect(a.start < b.end && b.start < a.end).toBe(true)
    const flight = byId.get('red-eye')!
    expect(toLocalDateTime(new Date(flight.end), ZONE).slice(0, 10)).toBe(addDays(TODAY, 3))
    const cottage = byId.get('cottage')!
    expect(cottage.allDay && cottage.end).toBe(addDays(cottage.start, 3)) // Fri, Sat, Sun → end is Monday
  })

  it('keeps wall-clock times across a DST change', () => {
    // The week of the 2026-11-01 fall-back: the standup is 09:30 local before and after.
    const events = generateFakeCalendar('2026-11-01', ZONE, { daysBefore: 6, daysAfter: 6 })
    const times = events.filter((e) => e.id.startsWith('standup-') && !e.title.includes('moved')).map((e) => toLocalDateTime(new Date(e.start), ZONE).slice(11))
    expect(new Set(times)).toEqual(new Set(['09:30']))
  })

  it('selects events overlapping a date range, including the cross-midnight tail', () => {
    const day3 = fakeEventsBetween(TODAY, ZONE, addDays(TODAY, 3), addDays(TODAY, 3))
    expect(day3.map((e) => e.id)).toEqual(expect.arrayContaining(['red-eye', 'pd-day']))
  })

  it('feeds the Today view', () => {
    const now = new Date('2026-10-07T16:00:00Z') // 12:00 local
    const m = buildToday({ tasks: [], events: fakeEventsBetween(TODAY, ZONE, TODAY, TODAY), now, zone: ZONE })
    expect(m.timeline.some((i) => i.kind === 'event' && i.event.title === 'Vendor demo')).toBe(true)
    // Wednesday's standup was cancelled.
    expect(m.timeline.some((i) => i.kind === 'event' && i.event.title.startsWith('Standup'))).toBe(false)
  })
})
