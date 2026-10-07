// App settings: a few typed values with defaults, stored as key/value text in
// whichever store the app runs on (SQLite table or localStorage).

import { ValidationError } from './tasks/normalize'
import { isLocalTime, type LocalTime } from './time'

export interface Settings {
  /** When "before due" reminders count back from for all-day tasks, and when "snooze until tomorrow" ends. */
  allDayReminderTime: LocalTime
  /** Start hidden in the tray when you sign in to Windows (desktop only, D15). */
  startAtLogin: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  allDayReminderTime: '09:00',
  startAtLogin: true,
}

export interface SettingsStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function readSettings(store: SettingsStore): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS }
  const time = store.get('allDayReminderTime')
  if (time && isLocalTime(time)) out.allDayReminderTime = time
  const login = store.get('startAtLogin')
  if (login === 'true' || login === 'false') out.startAtLogin = login === 'true'
  return out
}

/** Validates and saves a partial update; returns the full new settings. */
export function writeSettings(store: SettingsStore, patch: Partial<Settings>): Settings {
  if (patch.allDayReminderTime !== undefined) {
    if (!isLocalTime(patch.allDayReminderTime)) throw new ValidationError('allDayReminderTime', 'Use a time like 09:00.')
    store.set('allDayReminderTime', patch.allDayReminderTime)
  }
  if (patch.startAtLogin !== undefined) {
    if (typeof patch.startAtLogin !== 'boolean') throw new ValidationError('startAtLogin', 'Must be on or off.')
    store.set('startAtLogin', String(patch.startAtLogin))
  }
  return readSettings(store)
}
