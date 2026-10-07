import { expect, it } from 'vitest'
import { readSettings, writeSettings } from '../../src/core/settings'
import { openDatabase } from './database'
import { migrate } from './migrations'
import { sqliteSettingsStore } from './settingsStore'

it('stores settings in SQLite', () => {
  const db = openDatabase(':memory:')
  migrate(db)
  const store = sqliteSettingsStore(db)
  writeSettings(store, { allDayReminderTime: '08:15' })
  writeSettings(store, { allDayReminderTime: '08:30' })
  expect(readSettings(sqliteSettingsStore(db)).allDayReminderTime).toBe('08:30')
})
