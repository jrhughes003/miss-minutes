// Reminder rules: validating them, and working out when each one fires.

import type { Due } from '../recurrence'
import { ValidationError } from '../tasks/normalize'
import { isLocalDate, isLocalTime, resolveLocal, toLocalDateTime, type LocalTime } from '../time'
import type { ReminderInput, ReminderRule } from './types'

// The same limits as Google Calendar's popup reminders (at most 5, at most 4
// weeks before), so a reminder can always be mirrored to the phone (D8).
export const REMINDER_LIMITS = { perTask: 5, maxMinutesBefore: 40_320 } as const

export const DEFAULT_ALL_DAY_TIME: LocalTime = '09:00'

/**
 * Turns the UI's reminder list into stored rules. Existing rules (matched by
 * id) keep their id and scheduledAt unless their timing changed; new or
 * changed rules are scheduled from `now`.
 */
export function normalizeReminders(
  inputs: unknown,
  due: Due | null,
  existing: ReminderRule[],
  now: string,
  newId: () => string,
): ReminderRule[] {
  if (inputs === undefined || inputs === null) return []
  if (!Array.isArray(inputs)) throw new ValidationError('reminders', 'Reminders must be a list.')
  if (inputs.length > REMINDER_LIMITS.perTask) throw new ValidationError('reminders', `A task can have at most ${REMINDER_LIMITS.perTask} reminders.`)

  const byId = new Map(existing.map((r) => [r.id, r]))
  const seen = new Set<string>()
  const out: ReminderRule[] = []
  for (const raw of inputs as ReminderInput[]) {
    if (!raw || typeof raw !== 'object' || !raw.when || typeof raw.when !== 'object') {
      throw new ValidationError('reminders', 'A reminder is malformed.')
    }
    const when = raw.when
    if (when.kind === 'beforeDue') {
      if (!due) throw new ValidationError('reminders', 'A "before due" reminder needs a due date.')
      if (!Number.isInteger(when.minutes) || when.minutes < 0 || when.minutes > REMINDER_LIMITS.maxMinutesBefore) {
        throw new ValidationError('reminders', 'Reminders can be from 0 minutes to 4 weeks before the due time.')
      }
    } else if (when.kind === 'at') {
      if (!isLocalDate(when.date) || !isLocalTime(when.time)) throw new ValidationError('reminders', 'A reminder needs a real date and time.')
    } else {
      throw new ValidationError('reminders', 'Unknown reminder type.')
    }
    const clean = when.kind === 'beforeDue' ? { kind: 'beforeDue' as const, minutes: when.minutes } : { kind: 'at' as const, date: when.date, time: when.time }
    // Two identical reminders on one task would notify twice for nothing.
    const sig = JSON.stringify(clean)
    if (seen.has(sig)) continue
    seen.add(sig)

    const prior = raw.id ? byId.get(raw.id) : undefined
    const unchanged = prior && JSON.stringify(prior.when) === sig
    out.push({
      id: prior?.id ?? newId(),
      when: clean,
      phone: Boolean(raw.phone),
      scheduledAt: unchanged ? prior.scheduledAt : now,
    })
  }
  return out
}

/**
 * The wall-clock time a rule is due on a task, as "YYYY-MM-DDTHH:mm", or null
 * if it can't fire (a "before due" rule on a task with no due date).
 * Wall-clock arithmetic is done on the instant, so "15 minutes before 02:10" on
 * spring-forward day comes out right.
 */
export function occurrenceOf(rule: ReminderRule, due: Due | null, zone: string, allDayTime: LocalTime = DEFAULT_ALL_DAY_TIME): { local: string; instant: Date } | null {
  if (rule.when.kind === 'at') {
    const { instant } = resolveLocal(rule.when.date, rule.when.time, zone)
    return { local: `${rule.when.date}T${rule.when.time}`, instant }
  }
  if (!due) return null
  const base = resolveLocal(due.date, due.time ?? allDayTime, zone).instant
  const instant = new Date(base.getTime() - rule.when.minutes * 60_000)
  return { local: toLocalDateTime(instant, zone), instant }
}

/** Short English description: "At due time", "15 min before", "1 day before", "Wed Oct 7, 08:00". */
export function describeReminder(rule: Pick<ReminderRule, 'when'>, hasTime: boolean): string {
  const w = rule.when
  if (w.kind === 'at') return `${w.date} ${w.time}`
  const m = w.minutes
  const anchor = hasTime ? '' : ' (from the all-day reminder time)'
  if (m === 0) return hasTime ? 'At due time' : 'On the day'
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'} before${anchor}`
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} before${anchor}`
  return `${m} min before${anchor}`
}

export const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: 'At due time', minutes: 0 },
  { label: '5 minutes before', minutes: 5 },
  { label: '15 minutes before', minutes: 15 },
  { label: '1 hour before', minutes: 60 },
  { label: '1 day before', minutes: 1440 },
]
