// The reminder fire log over localStorage, for the web demo. Same claim rule as
// the SQLite version (see electron/db/reminderLog.ts), checked by the same
// contract tests.

import type { ReminderLog } from '../core/reminders/engine'
import { logKey } from '../core/reminders/planner'
import type { LogEntry, LogStatus } from '../core/reminders/types'
import type { KeyValueStorage } from './localRepo'

export const REMINDER_LOG_KEY = 'miss-minutes:reminder-log:v1'

export class LocalReminderLog implements ReminderLog {
  private entries: Record<string, LogEntry>
  private depth = 0

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key = REMINDER_LOG_KEY,
  ) {
    try {
      this.entries = JSON.parse(storage.getItem(key) ?? '{}') as Record<string, LogEntry>
    } catch {
      this.entries = {}
    }
  }

  private save(): void {
    if (this.depth === 0) this.storage.setItem(this.key, JSON.stringify(this.entries))
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn()
    const before = structuredClone(this.entries)
    this.depth++
    try {
      const result = fn()
      this.depth--
      this.save()
      return result
    } catch (e) {
      if (this.depth > 0) this.depth--
      this.entries = before
      throw e
    }
  }

  all(): LogEntry[] {
    return Object.values(this.entries).map((e) => ({ ...e }))
  }

  get(ruleId: string, occurrenceLocal: string): LogEntry | null {
    const e = this.entries[logKey(ruleId, occurrenceLocal)]
    return e ? { ...e } : null
  }

  claim(f: { ruleId: string; occurrenceLocal: string; taskId: string; firedFor: string; firedAt: string }): boolean {
    const k = logKey(f.ruleId, f.occurrenceLocal)
    const existing = this.entries[k]
    if (existing && !(existing.status === 'snoozed' && existing.firedFor < f.firedFor)) return false
    this.entries[k] = { ...f, status: 'fired', snoozeUntil: null }
    this.save()
    return true
  }

  update(ruleId: string, occurrenceLocal: string, patch: { status: LogStatus; snoozeUntil?: string | null }): void {
    const k = logKey(ruleId, occurrenceLocal)
    const existing = this.entries[k]
    if (!existing) return
    this.entries[k] = { ...existing, status: patch.status, snoozeUntil: patch.snoozeUntil ?? null }
    this.save()
  }
}
