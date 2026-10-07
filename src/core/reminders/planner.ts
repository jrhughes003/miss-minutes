// The reminder planner: a pure function that answers "what should fire right
// now?". It doesn't fire anything and doesn't remember anything; the engine
// does both. Keeping the decision pure means it can be tested against any
// clock, time zone and history.
//
// Why poll instead of setting one timer per reminder (D14):
// - A sleeping laptop doesn't run timers, and on wake, timers fire late or
//   not at all, depending on the OS.
// - setTimeout can't wait longer than about 24.8 days.
// - A poll asks the same question every time ("what is due by now that
//   hasn't fired?"), so missed reminders after sleep, a restart or a
//   time-zone change are caught by the same code path as on-time ones.

import type { Task } from '../tasks/types'
import type { LocalTime } from '../time'
import { occurrenceOf } from './rules'
import type { FireCandidate, LogEntry } from './types'

export const GRACE_MS = 2 * 60_000

export const logKey = (ruleId: string, occurrenceLocal: string) => `${ruleId}|${occurrenceLocal}`

export interface PlanInput {
  now: Date
  zone: string
  /** Open tasks; done tasks never remind. */
  tasks: Task[]
  /** The fire log, keyed by logKey. */
  log: Map<string, LogEntry>
  allDayTime?: LocalTime
  /** How late a fire can be and still count as "on time". */
  graceMs?: number
}

export function dueReminders(input: PlanInput): FireCandidate[] {
  const { now, zone, tasks, log } = input
  const grace = input.graceMs ?? GRACE_MS
  const out: FireCandidate[] = []

  for (const task of tasks) {
    if (task.status !== 'open') continue
    for (const rule of task.reminders) {
      const occ = occurrenceOf(rule, task.due, zone, input.allDayTime)
      if (!occ) continue
      // Scheduled after its time had passed: not a missed reminder, just a past one.
      if (occ.instant.getTime() < Date.parse(rule.scheduledAt)) continue

      const entry = log.get(logKey(rule.id, occ.local))
      let fireFor: Date | null = null
      if (!entry) {
        if (occ.instant <= now) fireFor = occ.instant
      } else if (entry.status === 'snoozed' && entry.snoozeUntil) {
        const until = new Date(entry.snoozeUntil)
        // `firedFor < until` makes this fire once per snooze, however often we poll.
        if (until <= now && Date.parse(entry.firedFor) < until.getTime()) fireFor = until
      }
      if (!fireFor) continue

      out.push({
        ruleId: rule.id,
        taskId: task.id,
        title: task.title,
        occurrenceLocal: occ.local,
        fireFor,
        late: now.getTime() - fireFor.getTime() > grace,
        phone: rule.phone,
      })
    }
  }
  return out.sort((a, b) => a.fireFor.getTime() - b.fireFor.getTime())
}
