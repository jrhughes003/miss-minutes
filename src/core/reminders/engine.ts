// The reminder engine: polls the planner, records each fire exactly once, and
// shows notifications. It runs in the Electron main process for the desktop
// app, and in the page for the web demo. Storage and notifications are
// injected, so tests drive it with a fake clock and fake notifier.
//
// How duplicates are prevented (the at-most-once guarantee):
// Every fire is first *claimed* in the log with a compare-and-set:
// "record that (rule, occurrence) fired for instant T, unless a fire for T or
// later is already recorded". Only a successful claim shows a notification.
// Two ticks racing after wake, a tick during a restart, or a planner that
// returns the same reminder twice can all try; only one claim succeeds.
// The claim is committed before the notification is shown, so a crash between
// the two loses at most that one notification (it still appears in the app's
// list of active reminders). Losing one is preferred over repeating one (D14).

import type { Clock } from '../clock'
import type { Task } from '../tasks/types'
import { addDays, resolveLocal, toLocalDate, type LocalTime } from '../time'
import { dueReminders, GRACE_MS, logKey } from './planner'
import { DEFAULT_ALL_DAY_TIME } from './rules'
import type { ActiveReminder, FireCandidate, LogEntry, ReminderAction, SnoozeChoice } from './types'

export interface ReminderLog {
  transaction<T>(fn: () => T): T
  all(): LogEntry[]
  get(ruleId: string, occurrenceLocal: string): LogEntry | null
  /**
   * Records a fire. Succeeds (returns true) only if there's no entry yet, or the
   * entry is snoozed and was last fired for an earlier instant than `firedFor`.
   */
  claim(fire: { ruleId: string; occurrenceLocal: string; taskId: string; firedFor: string; firedAt: string }): boolean
  update(ruleId: string, occurrenceLocal: string, patch: { status: LogEntry['status']; snoozeUntil?: string | null }): void
}

export interface Notification {
  title: string
  body: string
  /** Set for a single reminder, so clicking it can open that reminder. */
  reminder?: { ruleId: string; occurrenceLocal: string; taskId: string }
}

export interface Notifier {
  show(n: Notification): void
}

/** The parts of TaskService the engine needs. */
export interface ReminderTasks {
  listTasks(q: { status: 'open'; includeSubtasks: true }): Task[]
  getTask(id: string): Task | null
  completeTask(id: string): unknown
}

export interface EngineOptions {
  log: ReminderLog
  tasks: ReminderTasks
  notifier: Notifier
  clock: Clock
  allDayTime?: () => LocalTime
  graceMs?: number
  /** Called after anything the UI shows changes (fires, snoozes, dismissals). */
  onChange?: () => void
}

/** More on-time reminders than this in one tick are grouped into one notification. */
const MAX_SEPARATE = 3

export class ReminderEngine {
  constructor(private readonly o: EngineOptions) {}

  private get allDayTime(): LocalTime {
    return this.o.allDayTime?.() ?? DEFAULT_ALL_DAY_TIME
  }

  /** Fires everything that is due. Safe to call as often as you like. Returns what fired. */
  tick(): FireCandidate[] {
    const now = this.o.clock.now()
    const log = new Map(this.o.log.all().map((e) => [logKey(e.ruleId, e.occurrenceLocal), e]))
    const candidates = dueReminders({
      now,
      zone: this.o.clock.zone(),
      tasks: this.o.tasks.listTasks({ status: 'open', includeSubtasks: true }),
      log,
      allDayTime: this.allDayTime,
      graceMs: this.o.graceMs ?? GRACE_MS,
    })
    if (candidates.length === 0) return []

    const firedAt = now.toISOString()
    const claimed = this.o.log.transaction(() =>
      candidates.filter((c) =>
        this.o.log.claim({ ruleId: c.ruleId, occurrenceLocal: c.occurrenceLocal, taskId: c.taskId, firedFor: c.fireFor.toISOString(), firedAt }),
      ),
    )
    if (claimed.length === 0) return []

    this.notify(claimed)
    this.o.onChange?.()
    return claimed
  }

  private notify(fired: FireCandidate[]): void {
    const late = fired.filter((f) => f.late)
    const onTime = fired.filter((f) => !f.late)
    const single = (f: FireCandidate, prefix = '') =>
      this.o.notifier.show({
        title: prefix + f.title,
        body: 'Miss Minutes reminder. Click to snooze or mark done.',
        reminder: { ruleId: f.ruleId, occurrenceLocal: f.occurrenceLocal, taskId: f.taskId },
      })

    if (onTime.length > MAX_SEPARATE) {
      this.o.notifier.show({ title: `${onTime.length} reminders`, body: listTitles(onTime) })
    } else {
      onTime.forEach((f) => single(f))
    }
    // Catch-up after sleep or the app being closed: one summary, not a flood.
    if (late.length === 1) single(late[0]!, 'Missed: ')
    else if (late.length > 1) this.o.notifier.show({ title: `You missed ${late.length} reminders`, body: listTitles(late) })
  }

  /** Fired reminders the user hasn't acted on yet, for tasks that are still open. */
  active(): ActiveReminder[] {
    const grace = this.o.graceMs ?? GRACE_MS
    const out: ActiveReminder[] = []
    for (const e of this.o.log.all()) {
      if (e.status !== 'fired') continue
      const task = this.o.tasks.getTask(e.taskId)
      if (!task || task.status !== 'open') continue
      out.push({
        ruleId: e.ruleId,
        occurrenceLocal: e.occurrenceLocal,
        taskId: e.taskId,
        title: task.title,
        firedAt: e.firedAt,
        late: Date.parse(e.firedAt) - Date.parse(e.firedFor) > grace,
      })
    }
    return out.sort((a, b) => a.firedAt.localeCompare(b.firedAt))
  }

  /** Handles "done", "dismiss" or "snooze" on a fired reminder. */
  act(ruleId: string, occurrenceLocal: string, action: ReminderAction): void {
    const entry = this.o.log.get(ruleId, occurrenceLocal)
    if (!entry) throw new Error('That reminder has not fired.')
    if (action.kind === 'done') {
      this.o.tasks.completeTask(entry.taskId)
      // Every fired reminder for the task is settled once it's done.
      this.o.log.transaction(() => {
        for (const e of this.o.log.all()) {
          if (e.taskId === entry.taskId && (e.status === 'fired' || e.status === 'snoozed')) this.o.log.update(e.ruleId, e.occurrenceLocal, { status: 'done', snoozeUntil: null })
        }
      })
    } else if (action.kind === 'dismiss') {
      this.o.log.update(ruleId, occurrenceLocal, { status: 'dismissed', snoozeUntil: null })
    } else {
      const until = this.snoozeUntil(action.choice)
      this.o.log.update(ruleId, occurrenceLocal, { status: 'snoozed', snoozeUntil: until.toISOString() })
    }
    this.o.onChange?.()
  }

  /** The instant a snooze ends. "Tomorrow" means the all-day reminder time tomorrow, local time. */
  snoozeUntil(choice: SnoozeChoice): Date {
    const now = this.o.clock.now()
    if (choice.kind === 'minutes') {
      if (!Number.isInteger(choice.minutes) || choice.minutes < 1 || choice.minutes > 7 * 24 * 60) throw new Error('Snooze must be 1 minute to 7 days.')
      return new Date(now.getTime() + choice.minutes * 60_000)
    }
    if (choice.kind === 'tomorrow') {
      const zone = this.o.clock.zone()
      return resolveLocal(addDays(toLocalDate(now, zone), 1), this.allDayTime, zone).instant
    }
    const until = new Date(choice.instant)
    if (Number.isNaN(until.getTime()) || until <= now) throw new Error('Snooze until a time in the future.')
    return until
  }
}

function listTitles(items: FireCandidate[]): string {
  const shown = items.slice(0, 4).map((f) => `• ${f.title}`)
  if (items.length > 4) shown.push(`…and ${items.length - 4} more`)
  return shown.join('\n')
}
