// The natural-language parsing eval: a frozen case set (PLAN.md §5.1).
//
// Frozen on 2026-10-06, before any prompt was written. Don't edit cases after
// seeing results; add new ones in a dated block and say so in the results.
//
// Expected answers follow CAPTURE_CONVENTIONS (src/core/capture/types.ts) and
// are computed with plain calendar arithmetic, independently of both parsers,
// from six reference moments chosen to stress the hard parts: an ordinary
// Tuesday, a Friday afternoon, the evenings before both DST changes (Toronto
// and London), and New Year's Eve.
//
// Each case lands in the "dev" or "test" split by a stable hash of its id.
// Prompt work may look at dev only; test is run once per release candidate.

import type { CaptureResult } from '../../src/core/capture/types'
import { addDays, dayOfWeek, type LocalDate } from '../../src/core/time'

export type Category =
  | 'relative-day'
  | 'weekday'
  | 'time-of-day'
  | 'near-midnight'
  | 'dst'
  | 'recurrence'
  | 'metadata'
  | 'reminder'
  | 'no-date'
  | 'ambiguous'

export interface Expected {
  kind: 'task' | 'clarify'
  title?: string
  due?: CaptureResult['due']
  priority?: CaptureResult['priority']
  projectName?: string | null
  tags?: string[]
  recurrence?: string | null
  reminderMinutesBefore?: number | null
}

export interface ParseCase {
  id: string
  category: Category
  input: string
  nowLocal: string
  zone: string
  projectNames: string[]
  expected: Expected
  split: 'dev' | 'test'
}

interface Ref {
  key: string
  date: LocalDate
  time: string
  zone: string
}

const REFS: Ref[] = [
  { key: 'tue', date: '2026-10-06', time: '10:00', zone: 'America/Toronto' }, // Tuesday morning
  { key: 'fri', date: '2026-10-09', time: '16:00', zone: 'America/Toronto' }, // Friday afternoon
  { key: 'spring', date: '2026-03-07', time: '21:30', zone: 'America/Toronto' }, // Saturday before spring forward
  { key: 'fall', date: '2026-10-31', time: '22:00', zone: 'America/Toronto' }, // Saturday before fall back
  { key: 'london', date: '2026-03-28', time: '20:00', zone: 'Europe/London' }, // Saturday before UK spring forward
  { key: 'nye', date: '2026-12-31', time: '23:00', zone: 'America/Toronto' }, // New Year's Eve, late
]

const PROJECTS = ['Work', 'Home', 'Errands']
const TASKS = ['Call the dentist', 'Pay the electricity bill', 'Email Sam about the budget', 'Pick up the dry cleaning', 'Book flights to Halifax', 'Renew my passport', 'Water the plants', 'Submit the timesheet']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Defaults for a plain task, so each case states only what it tests. */
const task = (title: string, rest: Partial<Expected> = {}): Expected => ({
  kind: 'task',
  title,
  due: null,
  priority: 4,
  projectName: null,
  tags: [],
  recurrence: null,
  reminderMinutesBefore: null,
  ...rest,
})
const clarify = (): Expected => ({ kind: 'clarify' })
const day = (date: LocalDate, time: string | null = null) => ({ date, time })

/** The next occurrence of weekday `wd` strictly after `date`. */
const nextWeekday = (date: LocalDate, wd: number) => addDays(date, ((wd - dayOfWeek(date) + 7) % 7) || 7)
/** Monday of the week containing `date` (weeks start Monday). */
const mondayOf = (date: LocalDate) => addDays(date, -((dayOfWeek(date) + 6) % 7))
/** First occurrence of weekday `wd` on or after `date`. */
const onOrAfter = (date: LocalDate, wd: number) => addDays(date, (wd - dayOfWeek(date) + 7) % 7)

function buildCases(): Omit<ParseCase, 'split'>[] {
  const out: Omit<ParseCase, 'split'>[] = []
  let t = 0
  const nextTask = () => TASKS[t++ % TASKS.length]!
  const add = (ref: Ref, category: Category, input: string, expected: Expected) =>
    out.push({ id: `${ref.key}-${category}-${out.length}`, category, input, nowLocal: `${ref.date}T${ref.time}`, zone: ref.zone, projectNames: PROJECTS, expected })

  for (const ref of REFS) {
    const today = ref.date
    const dow = dayOfWeek(today)
    const hour = Number(ref.time.slice(0, 2))

    // --- Relative days
    let x = nextTask()
    add(ref, 'relative-day', `${x} tomorrow`, task(x, { due: day(addDays(today, 1)) }))
    x = nextTask()
    add(ref, 'relative-day', `${x} today`, task(x, { due: day(today) }))
    x = nextTask()
    add(ref, 'relative-day', `${x} in 3 days`, task(x, { due: day(addDays(today, 3)) }))
    x = nextTask()
    add(ref, 'relative-day', `${x} in two weeks`, task(x, { due: day(addDays(today, 14)) }))
    x = nextTask()
    add(ref, 'relative-day', `${x} the day after tomorrow`, task(x, { due: day(addDays(today, 2)) }))

    // --- Weekdays: bare, "this", "next"
    for (const wd of [1, 4, 5]) {
      x = nextTask()
      const name = WEEKDAYS[wd]!
      add(ref, wd === dow ? 'ambiguous' : 'weekday', `${x} ${name}`, wd === dow ? clarify() : task(x, { due: day(nextWeekday(today, wd)) }))
      x = nextTask()
      const thisDay = addDays(mondayOf(today), (wd + 6) % 7)
      add(ref, thisDay < today ? 'ambiguous' : 'weekday', `${x} this ${name}`, thisDay < today ? clarify() : task(x, { due: day(thisDay) }))
      x = nextTask()
      add(ref, 'weekday', `${x} next ${name}`, task(x, { due: day(addDays(mondayOf(today), 7 + ((wd + 6) % 7))) }))
    }

    // --- Times of day (all tomorrow, so "passed already" never matters)
    const tomorrow = addDays(today, 1)
    const times: [string, string][] = [
      ['at 3pm', '15:00'],
      ['at 9:30am', '09:30'],
      ['at noon', '12:00'],
      ['after lunch', '13:00'],
      ['morning', '09:00'],
      ['afternoon', '14:00'],
      ['at end of day', '17:00'],
      ['evening', '19:00'],
    ]
    for (const [phrase, time] of times) {
      x = nextTask()
      add(ref, 'time-of-day', `${x} tomorrow ${phrase}`, task(x, { due: day(tomorrow, time) }))
    }

    // --- Near midnight (evening references only, where "tonight" makes sense)
    if (hour >= 16) {
      x = nextTask()
      add(ref, 'near-midnight', `${x} tonight at 11:59pm`, task(x, { due: day(today, '23:59') }))
      x = nextTask()
      add(ref, 'near-midnight', `${x} tonight at 12:30`, task(x, { due: day(tomorrow, '00:30') }))
      x = nextTask()
      add(ref, 'ambiguous', `${x} at midnight on ${WEEKDAYS[(dow + 2) % 7]}`, clarify())
    }

    // --- DST: wall-clock times that don't exist or happen twice must be kept as written
    if (ref.key === 'spring') {
      x = nextTask()
      add(ref, 'dst', `${x} tomorrow at 2:30am`, task(x, { due: day(tomorrow, '02:30') }))
      x = nextTask()
      add(ref, 'dst', `${x} tomorrow at 3am`, task(x, { due: day(tomorrow, '03:00') }))
    }
    if (ref.key === 'fall') {
      x = nextTask()
      add(ref, 'dst', `${x} tomorrow at 1:30am`, task(x, { due: day(tomorrow, '01:30') }))
      x = nextTask()
      add(ref, 'dst', `${x} tomorrow at 2am`, task(x, { due: day(tomorrow, '02:00') }))
    }
    if (ref.key === 'london') {
      x = nextTask()
      add(ref, 'dst', `${x} tomorrow at 1:15am`, task(x, { due: day(tomorrow, '01:15') }))
    }

    // --- Recurrence (due = first occurrence on or after today; no times, so "passed" never matters)
    x = nextTask()
    add(ref, 'recurrence', `${x} every Monday`, task(x, { due: day(onOrAfter(today, 1)), recurrence: 'FREQ=WEEKLY;BYDAY=MO' }))
    x = nextTask()
    add(ref, 'recurrence', `${x} every day`, task(x, { due: day(today), recurrence: 'FREQ=DAILY' }))
    x = nextTask()
    const firstWeekday = [1, 2, 3, 4, 5].includes(dow) ? today : onOrAfter(today, 1)
    add(ref, 'recurrence', `${x} every weekday`, task(x, { due: day(firstWeekday), recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }))
    x = nextTask()
    add(ref, 'recurrence', `${x} every other Thursday`, task(x, { due: day(onOrAfter(today, 4)), recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH' }))
    x = nextTask()
    {
      // First Monday of a month, on or after today.
      let d = today
      while (!(dayOfWeek(d) === 1 && Number(d.slice(8)) <= 7)) d = addDays(d, 1)
      add(ref, 'recurrence', `${x} on the first Monday of every month`, task(x, { due: day(d), recurrence: 'FREQ=MONTHLY;BYDAY=1MO' }))
    }

    // --- Priority, tags, project
    x = nextTask()
    add(ref, 'metadata', `${x} p1`, task(x, { priority: 1 }))
    x = nextTask()
    add(ref, 'metadata', `urgent: ${x}`, task(x, { priority: 1 }))
    x = nextTask()
    add(ref, 'metadata', `${x} #home #errands`, task(x, { tags: ['errands', 'home'] }))
    x = nextTask()
    add(ref, 'metadata', `${x} @work`, task(x, { projectName: 'Work' }))
    x = nextTask()
    add(ref, 'metadata', `${x} for work tomorrow p2`, task(x, { projectName: 'Work', priority: 2, due: day(tomorrow) }))

    // --- Reminders
    x = nextTask()
    add(ref, 'reminder', `remind me to ${x.charAt(0).toLowerCase()}${x.slice(1)} tomorrow at 4pm`, task(x, { due: day(tomorrow, '16:00'), reminderMinutesBefore: 0 }))
    x = nextTask()
    add(ref, 'reminder', `${x} tomorrow at 2pm, remind me 30 minutes before`, task(x, { due: day(tomorrow, '14:00'), reminderMinutesBefore: 30 }))
    x = nextTask()
    add(ref, 'reminder', `${x} tomorrow at 10am remind me an hour before`, task(x, { due: day(tomorrow, '10:00'), reminderMinutesBefore: 60 }))

    // --- No date at all
    x = nextTask()
    add(ref, 'no-date', x, task(x))

    // --- Dates that don't exist
    x = nextTask()
    add(ref, 'ambiguous', `${x} on February 30`, clarify())
    x = nextTask()
    add(ref, 'ambiguous', `${x} on November 31st`, clarify())
  }
  return out
}

/** FNV-1a: a tiny stable hash, so a case's split never changes. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export const CASES: ParseCase[] = buildCases().map((c) => ({ ...c, split: fnv1a(c.id) % 2 === 0 ? 'dev' : 'test' }))

// Normalize the expected title the way the grader compares titles, keeping a
// leading capital out of the comparison ("call the dentist" = "Call the dentist").
export function casesFor(split: 'dev' | 'test' | 'all'): ParseCase[] {
  return split === 'all' ? CASES : CASES.filter((c) => c.split === split)
}
