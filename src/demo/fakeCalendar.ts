// A generated calendar for the web demo and for tests (PLAN.md §3).
//
// The demo can't use anyone's real Google Calendar, so it shows this instead.
// Two properties matter:
// - Deterministic: the same (seed, today, zone) always gives the same
//   events, so tests and screenshots are repeatable.
// - Relative to today: events are placed around the visitor's current date,
//   so the demo never looks stale.
//
// It deliberately includes the awkward cases the real integration must handle:
// a recurring meeting with one cancelled and one moved instance, overlapping
// events, an all-day event, a multi-day all-day event (exclusive end date), and
// an event that crosses midnight. Wall-clock times go through time.ts, so a
// week that contains a DST change still shows "09:30" as 09:30.

import { overlapsLocalRange, type CalendarEvent } from '../core/today'
import { addDays, dayOfWeek, toInstant, type LocalDate } from '../core/time'

export interface FakeCalendar {
  id: string
  name: string
  color: string
}

export const FAKE_CALENDARS: FakeCalendar[] = [
  { id: 'work', name: 'Work', color: '#2f5fa7' },
  { id: 'personal', name: 'Personal', color: '#2f6b3a' },
  { id: 'family', name: 'Family', color: '#7a3e9d' },
]

/** mulberry32: a tiny, fast, seedable PRNG. Not for security, just repeatability. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface FakeCalendarOptions {
  seed?: number
  /** First and last day generated, relative to today (default −14 to +30). */
  daysBefore?: number
  daysAfter?: number
}

/** Monday on or before `date`. */
function mondayOf(date: LocalDate): LocalDate {
  const dow = dayOfWeek(date) // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow)
}

export function generateFakeCalendar(today: LocalDate, zone: string, options: FakeCalendarOptions = {}): CalendarEvent[] {
  const random = rng(options.seed ?? 42)
  const from = addDays(today, -(options.daysBefore ?? 14))
  const to = addDays(today, options.daysAfter ?? 30)
  const events: CalendarEvent[] = []

  const timed = (id: string, calendarId: string, title: string, date: LocalDate, start: string, end: string, endDate: LocalDate = date) => {
    events.push({
      id,
      calendarId,
      title,
      allDay: false,
      start: toInstant(date, start, zone).toISOString(),
      end: toInstant(endDate, end, zone).toISOString(),
      color: FAKE_CALENDARS.find((c) => c.id === calendarId)!.color,
    })
  }
  const allDay = (id: string, calendarId: string, title: string, start: LocalDate, endExclusive: LocalDate) => {
    events.push({ id, calendarId, title, allDay: true, start, end: endExclusive, color: FAKE_CALENDARS.find((c) => c.id === calendarId)!.color })
  }

  // Exceptions to the recurring standup, both in the current week so they're visible in the demo.
  const thisMonday = mondayOf(today)
  const cancelledStandup = addDays(thisMonday, 2) // Wednesday: cancelled
  const movedStandup = addDays(thisMonday, 3) // Thursday: moved to 10:30

  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = dayOfWeek(d)
    const weekday = dow >= 1 && dow <= 5

    if (weekday && d !== cancelledStandup) {
      if (d === movedStandup) timed(`standup-${d}`, 'work', 'Standup (moved)', d, '10:30', '10:45')
      else timed(`standup-${d}`, 'work', 'Standup', d, '09:30', '09:45')
    }
    if (dow === 2) timed(`one-on-one-${d}`, 'work', '1:1 with Sam', d, '14:00', '14:30')
    if (dow === 4) timed(`review-${d}`, 'work', 'Project review', d, '15:00', '16:00')

    // A few seeded one-off meetings on weekdays, some of which overlap.
    if (weekday) {
      const count = Math.floor(random() * 3) // 0–2
      for (let i = 0; i < count; i++) {
        const startHour = 10 + Math.floor(random() * 6) // 10:00–15:00
        const half = random() < 0.5 ? '00' : '30'
        const long = random() < 0.4
        const endMinutes = startHour * 60 + (half === '30' ? 30 : 0) + (long ? 60 : 30)
        const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
        const titles = ['Design sync', 'Budget check-in', 'Customer call', 'Hiring panel', 'Planning']
        timed(`meeting-${d}-${i}`, 'work', titles[Math.floor(random() * titles.length)]!, d, `${String(startHour).padStart(2, '0')}:${half}`, end)
      }
    }

    if (dow === 1 || dow === 3 || dow === 5) timed(`gym-${d}`, 'personal', 'Gym', d, '18:00', '19:00')
    if (dow === 6) timed(`soccer-${d}`, 'family', 'Soccer practice', d, '10:00', '11:30')
  }

  // Fixed one-offs placed relative to today, so the demo always shows them.
  timed('overlap-a', 'work', 'Vendor demo', today, '13:00', '14:00')
  timed('overlap-b', 'personal', 'Dentist', today, '13:30', '14:15') // overlaps the vendor demo
  timed('red-eye', 'personal', 'Late flight', addDays(today, 2), '22:30', '01:15', addDays(today, 3)) // crosses midnight
  timed('dinner', 'personal', 'Dinner with Alex', addDays(today, 1), '19:00', '21:30')
  allDay('pd-day', 'family', 'School PD day', addDays(today, 3), addDays(today, 4))
  // A Friday-to-Sunday trip: three days, so the exclusive end date is Monday.
  const friday = addDays(thisMonday, 11)
  allDay('cottage', 'family', 'Cottage weekend', friday, addDays(friday, 3))

  return events
    .filter((e) => (e.allDay ? e.end > from && e.start <= to : true))
    .sort((a, b) => a.start.localeCompare(b.start))
}

/** Events overlapping the local dates [from, to], inclusive. */
export function fakeEventsBetween(today: LocalDate, zone: string, from: LocalDate, to: LocalDate, seed?: number): CalendarEvent[] {
  return generateFakeCalendar(today, zone, seed === undefined ? {} : { seed }).filter((e) => overlapsLocalRange(e, from, to, zone))
}
