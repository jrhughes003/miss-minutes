// The reminder fire log in SQLite (D14).
//
// `claim` is a single conditional upsert. The row's primary key
// (rule_id, occurrence_local) means a reminder can only ever be inserted once;
// the WHERE clause on the update only lets a snoozed reminder fire again, and
// only for a later instant than last time. SQLite reports how many rows
// changed, so `changes === 1` means "this fire is ours, show it" and
// `changes === 0` means "already fired, stay quiet".

import type { ReminderLog } from '../../src/core/reminders/engine'
import type { LogEntry, LogStatus } from '../../src/core/reminders/types'
import type { SqlDatabase, SqlRow } from './database'

export class SqliteReminderLog implements ReminderLog {
  private depth = 0
  private readonly stmt

  constructor(private readonly db: SqlDatabase) {
    this.stmt = {
      all: db.prepare('SELECT * FROM reminder_log'),
      get: db.prepare('SELECT * FROM reminder_log WHERE rule_id = @rule_id AND occurrence_local = @occurrence_local'),
      claim: db.prepare(`
        INSERT INTO reminder_log (rule_id, occurrence_local, task_id, status, fired_for, fired_at, snooze_until)
        VALUES (@rule_id, @occurrence_local, @task_id, 'fired', @fired_for, @fired_at, NULL)
        ON CONFLICT (rule_id, occurrence_local) DO UPDATE SET
          status = 'fired', fired_for = excluded.fired_for, fired_at = excluded.fired_at, snooze_until = NULL
        WHERE reminder_log.status = 'snoozed' AND reminder_log.fired_for < excluded.fired_for`),
      update: db.prepare(`
        UPDATE reminder_log SET status = @status, snooze_until = @snooze_until
        WHERE rule_id = @rule_id AND occurrence_local = @occurrence_local`),
    }
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.depth++
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    } finally {
      this.depth--
    }
  }

  all(): LogEntry[] {
    return this.stmt.all.all().map(toEntry)
  }

  get(ruleId: string, occurrenceLocal: string): LogEntry | null {
    const row = this.stmt.get.get({ rule_id: ruleId, occurrence_local: occurrenceLocal })
    return row ? toEntry(row) : null
  }

  claim(f: { ruleId: string; occurrenceLocal: string; taskId: string; firedFor: string; firedAt: string }): boolean {
    const { changes } = this.stmt.claim.run({
      rule_id: f.ruleId,
      occurrence_local: f.occurrenceLocal,
      task_id: f.taskId,
      fired_for: f.firedFor,
      fired_at: f.firedAt,
    })
    return Number(changes) === 1
  }

  update(ruleId: string, occurrenceLocal: string, patch: { status: LogStatus; snoozeUntil?: string | null }): void {
    this.stmt.update.run({ rule_id: ruleId, occurrence_local: occurrenceLocal, status: patch.status, snooze_until: patch.snoozeUntil ?? null })
  }
}

function toEntry(r: SqlRow): LogEntry {
  return {
    ruleId: String(r.rule_id),
    occurrenceLocal: String(r.occurrence_local),
    taskId: String(r.task_id),
    status: String(r.status) as LogStatus,
    firedFor: String(r.fired_for),
    firedAt: String(r.fired_at),
    snoozeUntil: r.snooze_until === null ? null : String(r.snooze_until),
  }
}
