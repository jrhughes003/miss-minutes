import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../../src/core/clock'
import { openDatabase, type SqlDatabase } from '../db/database'
import { migrate } from '../db/migrations'
import { sqliteSettingsStore } from '../db/settingsStore'
import { sqliteSecretStore } from '../google/secrets'
import { startMockAi, type MockAi } from './mockServer'
import { AiService } from './service'

const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(Buffer.from(s).map((b) => b ^ 0x33)), decrypt: (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x33)).toString() }
const ctx = { nowLocal: '2026-10-06T10:00', zone: 'America/Toronto', projectNames: [], tagNames: [] }
const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'

let db: SqlDatabase
let mock: MockAi
let clock: FakeClock
let ai: AiService

beforeEach(async () => {
  db = openDatabase(':memory:')
  migrate(db)
  mock = await startMockAi()
  clock = new FakeClock('2026-10-06T14:00:00Z')
  ai = new AiService({ db, secrets: sqliteSecretStore(db, cipher), settings: sqliteSettingsStore(db), clock, baseURL: mock.url })
})
afterEach(async () => {
  await mock.close()
  db.close()
})

describe('AiService', () => {
  it('understands on the device until a key is set, then uses the model and logs usage', async () => {
    expect((await ai.capture('Call mum tomorrow', ctx)).source).toBe('device')
    expect(mock.requests).toHaveLength(0)
    ai.setKey(KEY)
    const r = await ai.capture('Call mum tomorrow', ctx)
    expect(r).toMatchObject({ source: 'mock', note: null, result: { title: 'Call mum', due: { date: '2026-10-07', time: null } } })
    expect(ai.status().monthToDate.calls).toBe(1)
    expect(ai.status().byFeature.capture!.costUsd).toBeGreaterThan(0)
  })

  it('rejects something that isn’t an API key, and never stores it in plain text', () => {
    expect(() => ai.setKey('hello')).toThrow(/sk-ant-/)
    ai.setKey(KEY)
    const raw = db.prepare("SELECT group_concat(value) AS v FROM settings").get()!.v as string
    expect(raw).not.toContain('sk-ant-')
    expect(ai.status().keySet).toBe(true)
    expect(ai.clearKey().keySet).toBe(false)
  })

  it('respects the off switch', async () => {
    ai.setKey(KEY)
    ai.setPrefs({ enabled: false })
    expect((await ai.capture('x tomorrow', ctx)).source).toBe('device')
    expect(mock.requests).toHaveLength(0)
  })

  it('falls back on API errors with an explanation, and logs the failed call at no cost', async () => {
    ai.setKey(KEY)
    mock.failNext(5, 429)
    const r = await ai.capture('Call mum tomorrow', ctx)
    expect(r.source).toBe('device')
    expect(r.note).toMatch(/rate-limited/)
    expect(r.result.title).toBe('Call mum')
  })

  it('warns at the soft cap and stops at the hard cap', async () => {
    ai.setKey(KEY)
    ai.setPrefs({ softCapUsd: 0, hardCapUsd: 0.0005 })
    await ai.capture('one', ctx)
    expect(ai.status()).toMatchObject({ overSoftCap: true })
    // A couple of mock calls cost about $0.001 each, which crosses the hard cap.
    await ai.capture('two', ctx)
    expect(ai.status().blocked).toBe(true)
    const r = await ai.capture('three', ctx)
    expect(r).toMatchObject({ source: 'device', note: expect.stringMatching(/limit/) })
  })

  it('counts only this month', async () => {
    ai.setKey(KEY)
    await ai.capture('x', ctx)
    clock.set('2026-11-01T00:00:01Z')
    expect(ai.status().monthToDate.calls).toBe(0)
  })

  it('validates cap amounts', () => {
    expect(() => ai.setPrefs({ softCapUsd: -1 })).toThrow()
    expect(ai.setPrefs({ hardCapUsd: null }).hardCapUsd).toBeNull()
  })
})
