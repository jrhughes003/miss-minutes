// Runs the reminder engine in the main process, so reminders fire with the
// window closed (D14, D15).
//
// When the engine checks:
// - every 30 seconds (the "tick");
// - immediately on resume from sleep and on unlocking the screen, so a
//   reminder that fell due while the laptop slept is surfaced as soon as the
//   user is back rather than up to 30 s later;
// - at startup, which catches everything missed while the app was closed.
// Every check is the same idempotent question, so extra checks are harmless.

import { Notification, powerMonitor } from 'electron'
import type { Clock } from '../src/core/clock'
import { ReminderEngine, type Notifier, type ReminderLog, type ReminderTasks } from '../src/core/reminders/engine'
import type { LocalTime } from '../src/core/time'

export const DEFAULT_TICK_MS = 30_000

export interface ReminderServiceOptions {
  log: ReminderLog
  tasks: ReminderTasks
  clock: Clock
  allDayTime: () => LocalTime
  icon: string
  /** Called when a notification is clicked. */
  onOpen: (r: { ruleId: string; occurrenceLocal: string; taskId: string } | null) => void
  onChange: () => void
  tickMs?: number
}

export function startReminderService(o: ReminderServiceOptions): { engine: ReminderEngine; stop: () => void } {
  // Live notifications are kept referenced: on Windows, a garbage-collected
  // Notification can lose its click handler.
  const live = new Set<Notification>()

  const notifier: Notifier = {
    show(n) {
      if (!Notification.isSupported()) return
      const note = new Notification({ title: n.title, body: n.body, icon: o.icon, silent: false })
      live.add(note)
      note.on('click', () => o.onOpen(n.reminder ?? null))
      note.on('close', () => live.delete(note))
      note.show()
      // Drop our reference eventually even if Windows never reports a close.
      setTimeout(() => live.delete(note), 10 * 60_000).unref?.()
    },
  }

  const engine = new ReminderEngine({ log: o.log, tasks: o.tasks, clock: o.clock, notifier, allDayTime: o.allDayTime, onChange: o.onChange })

  const check = () => {
    try {
      engine.tick()
    } catch (e) {
      // A failing check must never stop future checks.
      console.error('Miss Minutes: reminder check failed', e)
    }
  }

  const timer = setInterval(check, o.tickMs ?? DEFAULT_TICK_MS)
  powerMonitor.on('resume', check)
  powerMonitor.on('unlock-screen', check)
  check()

  return {
    engine,
    stop: () => {
      clearInterval(timer)
      powerMonitor.removeListener('resume', check)
      powerMonitor.removeListener('unlock-screen', check)
    },
  }
}
