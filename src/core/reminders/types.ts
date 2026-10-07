import type { LocalDate, LocalTime } from '../time'

/**
 * When a reminder fires:
 * - `beforeDue`: N minutes before the task's due time (0 = at the due time).
 *   For an all-day task, it counts back from the "all-day reminder time"
 *   setting (09:00 by default) on the due date. These reminders carry over to
 *   the next occurrence of a repeating task.
 * - `at`: a fixed wall-clock date and time, independent of the due date
 *   ("remind me Wednesday at 8 about Friday's deadline"). It belongs to one
 *   occurrence only.
 */
export type ReminderWhen = { kind: 'beforeDue'; minutes: number } | { kind: 'at'; date: LocalDate; time: LocalTime }

/** A reminder rule, stored on its task. */
export interface ReminderRule {
  id: string
  when: ReminderWhen
  /** Also mirror to the phone through Google Calendar (D8; takes effect from M9). */
  phone: boolean
  /**
   * When this rule was last (re)scheduled. Occurrences earlier than this are
   * never fired, so setting a reminder for a time that has already passed, or
   * moving a task's due date into the past, doesn't trigger an instant
   * "missed reminder".
   */
  scheduledAt: string
}

/** What the UI sends when creating or editing reminders. `id` is kept for existing rules. */
export interface ReminderInput {
  id?: string
  when: ReminderWhen
  phone?: boolean
}

export type LogStatus = 'fired' | 'snoozed' | 'dismissed' | 'done'

/**
 * One row of the fire log: what happened to one occurrence of one rule.
 *
 * The key is (ruleId, occurrenceLocal), and occurrenceLocal is the
 * *wall-clock* time ("2026-10-08T13:30") the reminder was due, not the UTC
 * instant. Keying by wall-clock time means:
 * - changing time zone doesn't make an already-fired reminder fire again;
 * - the repeated hour at fall-back fires once, not twice;
 * - moving the task to a new time is a new occurrence, so it does fire.
 */
export interface LogEntry {
  ruleId: string
  occurrenceLocal: string
  taskId: string
  status: LogStatus
  /** The instant this occurrence last fired for: the original time, or the end of a snooze. */
  firedFor: string
  firedAt: string
  snoozeUntil: string | null
}

/** A reminder the planner says should fire now. */
export interface FireCandidate {
  ruleId: string
  taskId: string
  title: string
  occurrenceLocal: string
  /** The instant it's firing for (original time, or end of snooze). */
  fireFor: Date
  /** True if this fire is more than the grace period late (sleep, app closed). */
  late: boolean
  phone: boolean
}

export type SnoozeChoice = { kind: 'minutes'; minutes: number } | { kind: 'tomorrow' } | { kind: 'until'; instant: string }

export type ReminderAction = { kind: 'done' } | { kind: 'dismiss' } | { kind: 'snooze'; choice: SnoozeChoice }

/** A fired reminder waiting for the user to act on it, as shown in the UI. */
export interface ActiveReminder {
  ruleId: string
  occurrenceLocal: string
  taskId: string
  title: string
  firedAt: string
  late: boolean
}
