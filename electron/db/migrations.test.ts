import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './database'
import { backupTo, currentVersion, migrate, MIGRATIONS, type Migration } from './migrations'

const tmpDirs: string[] = []
function tmpFile(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-db-'))
  tmpDirs.push(dir)
  return path.join(dir, name)
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const extra: Migration = { version: MIGRATIONS.length + 1, description: 'test column', sql: 'ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0' }

describe('migrate', () => {
  it('creates a new database at the latest version without a backup', () => {
    const db = openDatabase(':memory:')
    const backup = vi.fn()
    expect(migrate(db, { backup })).toEqual(MIGRATIONS.map((m) => m.version))
    expect(currentVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect(backup).not.toHaveBeenCalled()
  })

  it('does nothing when already up to date', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    expect(migrate(db)).toEqual([])
  })

  it('backs up an existing database before upgrading it, and keeps its data', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    db.prepare("INSERT INTO projects VALUES ('p1', 'Home', '#000000', 1, 'x', 'x')").run()
    const backup = vi.fn()
    expect(migrate(db, { backup, migrations: [...MIGRATIONS, extra] })).toEqual([extra.version])
    expect(backup).toHaveBeenCalledWith(MIGRATIONS.at(-1)!.version)
    expect(db.prepare('SELECT name, archived FROM projects').get()).toEqual({ name: 'Home', archived: 0 })
  })

  it('rolls back a failing migration completely', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    const broken: Migration = { version: extra.version, description: 'broken', sql: 'ALTER TABLE projects ADD COLUMN ok INTEGER; THIS IS NOT SQL;' }
    expect(() => migrate(db, { migrations: [...MIGRATIONS, broken] })).toThrow(`Migration ${broken.version} (broken) failed`)
    expect(currentVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const cols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name)
    expect(cols).not.toContain('ok')
  })

  it('refuses a database from a newer version of the app', () => {
    const db = openDatabase(':memory:')
    db.exec('PRAGMA user_version = 99')
    expect(() => migrate(db)).toThrow(/newer version/)
  })
})

describe('backupTo', () => {
  it('writes a consistent, openable copy of a live database', () => {
    const file = tmpFile('live.db')
    const db = openDatabase(file)
    migrate(db)
    db.prepare("INSERT INTO projects VALUES ('p1', 'Home', '#000000', 1, 'x', 'x')").run()
    const copy = tmpFile('copy.db')
    backupTo(db, copy)
    db.close()
    const restored = openDatabase(copy)
    expect(currentVersion(restored)).toBe(MIGRATIONS.at(-1)!.version)
    expect(restored.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'Home' }])
    restored.close()
  })
})
