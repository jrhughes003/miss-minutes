// Opening the SQLite database.
//
// The rest of the code depends only on the small `SqlDatabase` interface
// below, not on a particular driver. Today the driver is Node's built-in
// `node:sqlite` (D26). `better-sqlite3` has the same prepare/run/get/all/exec
// shape, so switching back means changing only this file.

import { DatabaseSync } from 'node:sqlite'

export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlParams = Record<string, SqlValue>
export type SqlRow = Record<string, SqlValue>

export interface SqlStatement {
  run(params?: SqlParams): { changes: number | bigint }
  get(params?: SqlParams): SqlRow | undefined
  all(params?: SqlParams): SqlRow[]
}

export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}

/**
 * Opens (creating if needed) a database file, or ':memory:' for tests.
 *
 * Pragmas, and why:
 * - foreign_keys=ON: SQLite ignores REFERENCES clauses unless asked.
 * - journal_mode=WAL: readers don't block the writer, and a crash mid-write
 *   can't corrupt the file.
 * - busy_timeout: if another connection (for example a backup) holds a lock,
 *   wait briefly instead of failing at once.
 */
export function openDatabase(file: string): SqlDatabase {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 3000')
  return wrap(db)
}

function wrap(db: DatabaseSync): SqlDatabase {
  return {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const stmt = db.prepare(sql)
      return {
        run: (params = {}) => stmt.run(params),
        get: (params = {}) => stmt.get(params) as SqlRow | undefined,
        all: (params = {}) => stmt.all(params) as SqlRow[],
      }
    },
    close: () => db.close(),
  }
}
