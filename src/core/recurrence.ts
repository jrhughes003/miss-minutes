// Repeating tasks.
//
// Two kinds of repeat (D4):
// - "rule": an iCalendar RRULE such as "FREQ=WEEKLY;BYDAY=TU,TH". This is the
//   same format Google Calendar uses, so rules can be shown, stored and later
//   exported without translation. Schedule-based: the next due date follows
//   the calendar, whenever you finish.
// - "afterCompletion": "every 3 days after I do it". Completion-based: the
//   next due date counts from the day you actually finished.
//
// The rrule library expands rules, but it's run in *floating* time: wall-clock
// fields are packed into a Date as if they were UTC, so the library never sees
// a time zone and never applies DST. Converting a wall-clock due time to a real
// instant happens later, in time.ts, under one tested DST policy. (rrule's own
// time-zone support is a known source of bugs.)

import * as rrule from 'rrule'

// rrule ships CommonJS (its "main") plus an ES build (its "module"). Bundlers
// (Vite, esbuild, Vitest) read the ES build and see named exports. Node's own
// ESM loader, which Playwright's test runner uses, sees only the CommonJS
// build, where everything hangs off the default export. This line works in both.
type RRuleModule = typeof rrule
const RRule: RRuleModule['RRule'] = ((rrule as unknown as { default?: RRuleModule }).default ?? rrule).RRule
type RRuleInstance = InstanceType<RRuleModule['RRule']>
import { addDays, addMonths, isLocalDate, isLocalTime, type LocalDate, type LocalTime } from './time'

export type Recurrence =
  | { kind: 'rule'; rrule: string }
  | { kind: 'afterCompletion'; every: number; unit: 'day' | 'week' | 'month' }

/** When a task is due: a date, optionally with a wall-clock time. */
export interface Due {
  date: LocalDate
  time: LocalTime | null
}

// ---------------------------------------------------------------------------
// Validation

const ALLOWED_FREQ = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])

/** Strips an optional "RRULE:" prefix and whitespace, and upper-cases the rule. */
export function normalizeRrule(rule: string): string {
  return rule.trim().replace(/^RRULE:/i, '').toUpperCase()
}

/**
 * Returns an error message, or null if the recurrence is usable.
 *
 * Restrictions beyond RFC 5545, and why:
 * - No DTSTART: the task's due date is the anchor, so a second one would conflict.
 * - No COUNT: each completion re-anchors the rule at the new due date, so
 *   "COUNT=5" would restart at 5 every time. UNTIL (an end date) works fine.
 * - No HOURLY/MINUTELY/SECONDLY: tasks repeat by day at most. Use a reminder
 *   for anything more frequent.
 */
export function validateRecurrence(r: Recurrence): string | null {
  if (r.kind === 'afterCompletion') {
    if (!Number.isInteger(r.every) || r.every < 1 || r.every > 365) return 'Repeat interval must be a whole number from 1 to 365.'
    if (!['day', 'week', 'month'].includes(r.unit)) return 'Repeat unit must be day, week or month.'
    return null
  }
  const rule = normalizeRrule(r.rrule)
  const parts = new Map(
    rule.split(';').filter(Boolean).map((p) => {
      const [k, v] = p.split('=')
      return [k ?? '', v ?? ''] as const
    }),
  )
  if (parts.has('DTSTART')) return 'The rule must not contain DTSTART; the due date is the start.'
  if (parts.has('COUNT')) return 'Use an end date (UNTIL) instead of a count.'
  const freq = parts.get('FREQ')
  if (!freq) return 'The rule needs a FREQ.'
  if (!ALLOWED_FREQ.has(freq)) return 'Tasks can repeat daily, weekly, monthly or yearly.'
  try {
    RRule.fromString(rule)
  } catch (e) {
    return `Invalid repeat rule: ${(e as Error).message}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Floating-time helpers

function floating(date: LocalDate, time: LocalTime | null): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const [h, mi] = (time ?? '00:00').split(':').map(Number) as [number, number]
  return new Date(Date.UTC(y, mo - 1, d, h, mi))
}

function fromFloating(f: Date, withTime: boolean): Due {
  const iso = f.toISOString() // YYYY-MM-DDTHH:mm:ss.sssZ, fields are wall-clock
  return { date: iso.slice(0, 10), time: withTime ? iso.slice(11, 16) : null }
}

function ruleAnchoredAt(due: Due, rule: string): RRuleInstance {
  const options = RRule.parseString(normalizeRrule(rule))
  return new RRule({ ...options, dtstart: floating(due.date, due.time) })
}

// ---------------------------------------------------------------------------
// Next occurrence

export interface CompletionContext {
  /** Today's date in the user's zone. */
  today: LocalDate
  /** The local date the task was completed on (usually today). */
  completedOn: LocalDate
}

/**
 * The due date of the next occurrence after completing a repeating task, or
 * null if the series has ended (UNTIL has passed).
 *
 * Rule-based tasks: the first occurrence strictly after the current due date.
 * If that is still in the past (the task was overdue for a while), skip ahead
 * to the first occurrence on or after today, so finishing a long-overdue daily
 * task doesn't create a backlog of overdue copies (D27). The rule's cadence is
 * kept: "every 2 weeks on Tuesday" stays on the same alternating Tuesdays.
 *
 * After-completion tasks: counted from the completion date, keeping the time
 * of day.
 */
export function nextDue(due: Due, recurrence: Recurrence, ctx: CompletionContext): Due | null {
  const problem = validateRecurrence(recurrence)
  if (problem) throw new Error(problem)
  if (!isLocalDate(due.date) || (due.time !== null && !isLocalTime(due.time))) throw new Error('Invalid due date')

  if (recurrence.kind === 'afterCompletion') {
    const { every, unit } = recurrence
    const date =
      unit === 'day' ? addDays(ctx.completedOn, every)
      : unit === 'week' ? addDays(ctx.completedOn, 7 * every)
      : addMonths(ctx.completedOn, every)
    return { date, time: due.time }
  }

  const rule = ruleAnchoredAt(due, recurrence.rrule)
  const withTime = due.time !== null
  let next = rule.after(floating(due.date, due.time), false)
  if (next && fromFloating(next, withTime).date < ctx.today) {
    next = rule.after(floating(ctx.today, '00:00'), true)
  }
  return next ? fromFloating(next, withTime) : null
}

/** The next `count` occurrences from `due` (inclusive if `due` matches the rule). For previews and tests. */
export function previewOccurrences(due: Due, rrule: string, count: number): Due[] {
  const rule = ruleAnchoredAt(due, rrule)
  const out: Due[] = []
  rule.all((d: Date, i: number) => {
    if (i >= count) return false
    out.push(fromFloating(d, due.time !== null))
    return true
  })
  return out
}

/** A short English description, e.g. "every week on Tuesday" or "3 days after completion". */
export function describeRecurrence(r: Recurrence): string {
  if (r.kind === 'afterCompletion') {
    const unit = r.every === 1 ? r.unit : `${r.unit}s`
    return `${r.every} ${unit} after completion`
  }
  try {
    return RRule.fromString(normalizeRrule(r.rrule)).toText()
  } catch {
    return 'custom repeat'
  }
}

/** Common presets offered in the task editor. */
export const RECURRENCE_PRESETS: { label: string; recurrence: Recurrence }[] = [
  { label: 'Every day', recurrence: { kind: 'rule', rrule: 'FREQ=DAILY' } },
  { label: 'Every weekday', recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } },
  { label: 'Every week', recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY' } },
  { label: 'Every 2 weeks', recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY;INTERVAL=2' } },
  { label: 'Every month', recurrence: { kind: 'rule', rrule: 'FREQ=MONTHLY' } },
  { label: 'Every year', recurrence: { kind: 'rule', rrule: 'FREQ=YEARLY' } },
]
