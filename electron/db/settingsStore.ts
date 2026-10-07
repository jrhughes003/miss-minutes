import type { SettingsStore } from '../../src/core/settings'
import type { SqlDatabase } from './database'

export function sqliteSettingsStore(db: SqlDatabase): SettingsStore {
  const get = db.prepare('SELECT value FROM settings WHERE key = @key')
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
  return {
    get: (key) => {
      const row = get.get({ key })
      return row ? String(row.value) : null
    },
    set: (key, value) => void set.run({ key, value }),
  }
}
