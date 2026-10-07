// Schema migrations.
//
// The database records its schema version in SQLite's built-in `user_version`
// field. On startup, every migration newer than that version runs in order,
// each inside a transaction together with the version bump, so a failure part
// way leaves the database exactly as it was.
//
// How this keeps an installed user's data safe:
// 1. Migrations only ever move forward. A released migration is never edited;
//    a change means a new migration.
// 2. Before upgrading an existing database, a full copy is written next to it
//    (`missminutes.db.pre-v2.bak`) with `VACUUM INTO`, which produces a clean,
//    consistent copy even while the database is open.
// 3. A database from a *newer* version of the app (after a downgrade) is
//    refused rather than opened, because older code could damage data it
//    doesn't understand.

import type { SqlDatabase } from './database'

export interface Migration {
  version: number
  description: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'projects, tasks and task tags',
    sql: `
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        color       TEXT NOT NULL,
        sort_order  REAL NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id                TEXT PRIMARY KEY,
        title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 1024),
        notes             TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 8192),
        -- Deleting a project moves its tasks to the Inbox (D28). The service
        -- does this explicitly; the SET NULL is the backstop.
        project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
        priority          INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4),
        -- Wall-clock due date/time with no zone (D6): 'YYYY-MM-DD' and 'HH:mm'.
        due_date          TEXT,
        due_time          TEXT CHECK (due_time IS NULL OR due_date IS NOT NULL),
        estimate_minutes  INTEGER,
        -- JSON: {"kind":"rule","rrule":"..."} or {"kind":"afterCompletion",...}
        recurrence        TEXT,
        parent_id         TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        status            TEXT NOT NULL CHECK (status IN ('open', 'done')),
        completed_at      TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        sort_order        REAL NOT NULL
      );
      CREATE INDEX tasks_by_status_due ON tasks (status, due_date);
      CREATE INDEX tasks_by_parent ON tasks (parent_id);
      CREATE INDEX tasks_by_project ON tasks (project_id);

      -- Tags in their own table so "all tasks tagged X" is an indexed lookup.
      CREATE TABLE task_tags (
        task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag      TEXT NOT NULL,
        PRIMARY KEY (task_id, tag)
      );
      CREATE INDEX task_tags_by_tag ON task_tags (tag);
    `,
  },
  {
    version: 2,
    description: 'reminders, the reminder fire log and settings',
    sql: `
      -- JSON array of reminder rules, stored with the task they belong to so
      -- a repeating task's next occurrence carries them over automatically.
      ALTER TABLE tasks ADD COLUMN reminders TEXT NOT NULL DEFAULT '[]';

      -- One row per (rule, wall-clock occurrence): the at-most-once fire log
      -- (D14). The primary key is what stops a reminder firing twice.
      CREATE TABLE reminder_log (
        rule_id           TEXT NOT NULL,
        occurrence_local  TEXT NOT NULL,
        task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        status            TEXT NOT NULL CHECK (status IN ('fired', 'snoozed', 'dismissed', 'done')),
        fired_for         TEXT NOT NULL,
        fired_at          TEXT NOT NULL,
        snooze_until      TEXT,
        PRIMARY KEY (rule_id, occurrence_local)
      );
      CREATE INDEX reminder_log_by_task ON reminder_log (task_id);

      CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    description: 'Google calendars and the cached event window',
    sql: `
      CREATE TABLE google_calendars (
        id           TEXT PRIMARY KEY,
        summary      TEXT NOT NULL,
        color        TEXT,
        access_role  TEXT NOT NULL,
        is_primary   INTEGER NOT NULL DEFAULT 0,
        -- Whether the user wants this calendar in Miss Minutes.
        selected     INTEGER NOT NULL,
        sort_order   INTEGER NOT NULL
      );

      -- A cache of the synced window (D11), replaced per calendar on each sync.
      -- The event is stored as JSON (the app's CalendarEvent); nothing queries
      -- inside it.
      CREATE TABLE calendar_events (
        id           TEXT PRIMARY KEY,
        calendar_id  TEXT NOT NULL REFERENCES google_calendars(id) ON DELETE CASCADE,
        data         TEXT NOT NULL
      );
      CREATE INDEX calendar_events_by_calendar ON calendar_events (calendar_id);
    `,
  },
  {
    version: 4,
    description: 'AI usage log',
    sql: `
      -- One row per Claude call, for the usage display and spending caps (D19).
      -- Token counts and cost only: never the prompt or the reply.
      CREATE TABLE ai_usage (
        id                  INTEGER PRIMARY KEY,
        at                  TEXT NOT NULL,
        feature             TEXT NOT NULL,
        model               TEXT NOT NULL,
        input_tokens        INTEGER NOT NULL,
        output_tokens       INTEGER NOT NULL,
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
        cost_usd            REAL NOT NULL,
        latency_ms          INTEGER NOT NULL,
        ok                  INTEGER NOT NULL
      );
      CREATE INDEX ai_usage_by_time ON ai_usage (at);
    `,
  },
]

export function currentVersion(db: SqlDatabase): number {
  const row = db.prepare('PRAGMA user_version').get()
  return Number(row?.user_version ?? 0)
}

export interface MigrateOptions {
  /** Called once, before the first migration, when upgrading a database that already has data. */
  backup?: (fromVersion: number) => void
  migrations?: Migration[]
}

/** Brings the schema up to date. Returns the versions applied. */
export function migrate(db: SqlDatabase, options: MigrateOptions = {}): number[] {
  const migrations = [...(options.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version)
  const latest = migrations.at(-1)?.version ?? 0
  const from = currentVersion(db)

  if (from > latest) {
    throw new Error(
      `This database was created by a newer version of Miss Minutes (schema ${from}, this app knows ${latest}). ` +
        'Install the newer version, or restore a backup.',
    )
  }
  const pending = migrations.filter((m) => m.version > from)
  if (pending.length === 0) return []
  if (from > 0) options.backup?.(from)

  const applied: number[] = []
  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(m.sql)
      // PRAGMA can't take a bound parameter; the version is a number from our own code.
      db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`)
      db.exec('COMMIT')
      applied.push(m.version)
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${m.version} (${m.description}) failed: ${(e as Error).message}`, { cause: e })
    }
  }
  return applied
}

/** Writes a consistent copy of the open database to `file` (which must not exist). */
export function backupTo(db: SqlDatabase, file: string): void {
  db.prepare('VACUUM INTO @file').run({ file })
}
