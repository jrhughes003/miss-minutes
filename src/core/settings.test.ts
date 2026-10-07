import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, readSettings, writeSettings, type SettingsStore } from './settings'

const mem = (): SettingsStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) }
}

describe('settings', () => {
  it('falls back to defaults for missing or corrupt values', () => {
    const s = mem()
    expect(readSettings(s)).toEqual(DEFAULT_SETTINGS)
    s.data.set('allDayReminderTime', '9am')
    s.data.set('startAtLogin', 'yes')
    expect(readSettings(s)).toEqual(DEFAULT_SETTINGS)
  })

  it('validates and saves updates', () => {
    const s = mem()
    expect(writeSettings(s, { allDayReminderTime: '07:30', startAtLogin: false })).toEqual({ allDayReminderTime: '07:30', startAtLogin: false })
    expect(() => writeSettings(s, { allDayReminderTime: '7:30' })).toThrow(/09:00/)
    expect(() => writeSettings(s, { startAtLogin: 'no' as never })).toThrow()
    expect(readSettings(s).allDayReminderTime).toBe('07:30')
  })
})
