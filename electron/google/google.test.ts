// The Google integration end to end, against the local fake Google server.
// No request in this file reaches Google.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type SqlDatabase } from '../db/database'
import { migrate } from '../db/migrations'
import { GoogleApi, GoogleApiError, backoffMs } from './api'
import { GoogleAuth } from './auth'
import { CalendarStore } from './calendarStore'
import { syncCalendars } from './calendarSync'
import { FAKE_CLIENT, startFakeGoogle, type FakeGoogle } from './fakeGoogle'
import { CALENDAR_READ_SCOPES, exchangeCode, NeedsReconnectError } from './oauth'
import { sqliteSecretStore, type Cipher } from './secrets'

const ZONE = 'America/Toronto'
const TODAY = '2026-10-07'
const NOW = new Date('2026-10-07T16:00:00Z') // 12:00 local

// A reversible stand-in for safeStorage, so tests can check nothing is stored in plain text.
const testCipher: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
}
const clientJson = JSON.stringify({ installed: { client_id: FAKE_CLIENT.clientId, client_secret: FAKE_CLIENT.clientSecret } })

let fake: FakeGoogle
let db: SqlDatabase
let clock: number

function setup() {
  const secrets = sqliteSecretStore(db, testCipher)
  const auth = new GoogleAuth({ fetch, endpoints: fake.endpoints, secrets, openBrowser: (url) => fake.consent(url), now: () => clock })
  const sleeps: number[] = []
  const api = new GoogleApi({ fetch, endpoints: fake.endpoints, auth, sleep: async (ms) => void sleeps.push(ms), random: () => 0 })
  const store = new CalendarStore(db)
  return { auth, api, store, sleeps, secrets }
}

beforeEach(async () => {
  fake = await startFakeGoogle({ today: TODAY, zone: ZONE, pageSize: 7 }) // small pages, to exercise paging
  db = openDatabase(':memory:')
  migrate(db)
  clock = Date.now()
})
afterEach(async () => {
  await fake.close()
  db.close()
})

describe('connecting', () => {
  it('signs in with PKCE through the loopback redirect and stores tokens encrypted', async () => {
    const { auth } = setup()
    expect(auth.status()).toEqual({ clientConfigured: false, connected: false, scopes: [] })
    auth.importClient(clientJson)
    await auth.connect(CALENDAR_READ_SCOPES)
    expect(auth.status()).toMatchObject({ clientConfigured: true, connected: true, scopes: [...CALENDAR_READ_SCOPES] })
    // Nothing secret is readable in the database itself.
    const raw = db.prepare("SELECT group_concat(value, ' ') AS v FROM settings").get()!.v as string
    expect(raw).not.toContain('rt-')
    expect(raw).not.toContain(FAKE_CLIENT.clientSecret)
  })

  it('needs the client before connecting', async () => {
    await expect(setup().auth.connect(CALENDAR_READ_SCOPES)).rejects.toThrow(/Import your Google OAuth client/)
  })

  it('reports a cancelled consent', async () => {
    const secrets = sqliteSecretStore(db, testCipher)
    const auth = new GoogleAuth({ fetch, endpoints: fake.endpoints, secrets, openBrowser: (url) => fake.consent(url, 'deny') })
    auth.importClient(clientJson)
    await expect(auth.connect(CALENDAR_READ_SCOPES)).rejects.toThrow(/cancelled/)
    expect(auth.status().connected).toBe(false)
  })

  it('rejects a code redeemed with the wrong PKCE verifier (a stolen code is useless)', async () => {
    // Capture a real code by playing browser, then redeem it with a forged verifier.
    const { buildAuthUrl, createPkce } = await import('./oauth')
    const { challenge } = createPkce()
    const res = await fetch(buildAuthUrl({ endpoints: fake.endpoints, clientId: FAKE_CLIENT.clientId, redirectUri: 'http://127.0.0.1:9/', scopes: CALENDAR_READ_SCOPES, challenge, state: 's' }), { redirect: 'manual' })
    const code = new URL(res.headers.get('location')!).searchParams.get('code')!
    await expect(exchangeCode(fetch, fake.endpoints, FAKE_CLIENT, { code, verifier: createPkce().verifier, redirectUri: 'http://127.0.0.1:9/', now: 0 })).rejects.toThrow(NeedsReconnectError)
  })
})

describe('staying connected', () => {
  it('refreshes an expiring access token, once even when asked concurrently', async () => {
    const { auth } = setup()
    auth.importClient(clientJson)
    await auth.connect(CALENDAR_READ_SCOPES)
    const first = await auth.accessToken()
    clock += 3600_000 // an hour later
    const before = fake.requests.filter((r) => r.path === '/token').length
    const [a, b] = await Promise.all([auth.accessToken(), auth.accessToken()])
    expect(a).toBe(b)
    expect(a).not.toBe(first)
    expect(fake.requests.filter((r) => r.path === '/token').length - before).toBe(1)
  })

  it('turns a revoked grant into "reconnect needed" and forgets the tokens', async () => {
    const { auth } = setup()
    auth.importClient(clientJson)
    await auth.connect(CALENDAR_READ_SCOPES)
    fake.revokeAll() // the user removed access, or Testing-mode tokens hit their 7-day limit
    clock += 3600_000
    await expect(auth.accessToken()).rejects.toThrow(NeedsReconnectError)
    expect(auth.status()).toMatchObject({ connected: false, clientConfigured: true })
  })

  it('recovers from a 401 mid-flight by refreshing once', async () => {
    const { auth, api } = setup()
    auth.importClient(clientJson)
    await auth.connect(CALENDAR_READ_SCOPES)
    fake.expireAccessTokens() // the server says no, although our clock thinks the token is fine
    expect((await api.listCalendars()).length).toBeGreaterThan(0)
  })

  it('disconnects by revoking at Google and forgetting locally', async () => {
    const { auth } = setup()
    auth.importClient(clientJson)
    await auth.connect(CALENDAR_READ_SCOPES)
    await auth.disconnect()
    expect(auth.status().connected).toBe(false)
    expect(fake.requests.some((r) => r.path === '/revoke')).toBe(true)
  })
})

describe('the API client', () => {
  it('backs off exponentially with jitter on rate limits, then succeeds', async () => {
    const { auth, api, sleeps } = setup()
    auth.importClient(clientJson)
    await auth.connect(CALENDAR_READ_SCOPES)
    fake.rateLimitNext(3)
    expect((await api.listCalendars()).length).toBe(4)
    expect(sleeps).toEqual([1000, 2000, 4000])
  })

  it('gives up after the retry limit with a clear error', async () => {
    const { auth, api } = setup()
    auth.importClient(clientJson)
    await auth.connect(CALENDAR_READ_SCOPES)
    fake.rateLimitNext(10)
    await expect(api.listCalendars()).rejects.toThrow(GoogleApiError)
  })

  it('caps the backoff at 32 seconds', () => {
    expect(backoffMs(0, () => 0.5)).toBe(1500)
    expect(backoffMs(10, () => 0.99)).toBe(32_000)
  })
})

describe('calendar sync', () => {
  async function connected() {
    const s = setup()
    s.auth.importClient(clientJson)
    await s.auth.connect(CALENDAR_READ_SCOPES)
    return s
  }

  it('stores the calendar list with sensible default selection', async () => {
    const { api, store } = await connected()
    await syncCalendars(api, store, NOW, ZONE)
    expect(store.calendars().map((c) => [c.summary, c.selected, c.readable])).toEqual([
      ['Work', true, true], // primary
      ['Personal', true, true],
      ['Family', false, true], // hidden in Google's own sidebar → off by default
      ['Colleague (free/busy)', false, false],
    ])
  })

  it('caches the event window across pages, drops cancelled instances, and serves Today', async () => {
    const { api, store } = await connected()
    const result = await syncCalendars(api, store, NOW, ZONE)
    expect(result.events).toBeGreaterThan(20) // several pages of 7
    const today = store.eventsBetween(TODAY, TODAY, ZONE)
    expect(today.map((e) => e.title)).toEqual(expect.arrayContaining(['Vendor demo', 'Dentist']))
    expect(today.every((e) => !e.title.startsWith('Standup') || e.title === 'Standup (moved)')).toBe(true)
    expect(today.find((e) => e.title === 'Vendor demo')?.color).toBe('#2f5fa7') // colour from the calendar
  })

  it('handles calendar ids that need URL-encoding (# and @)', async () => {
    const { api, store } = await connected()
    await syncCalendars(api, store, NOW, ZONE)
    expect(store.eventsBetween(TODAY, TODAY, ZONE).some((e) => e.calendarId.includes('#'))).toBe(true)
  })

  it('follows the user’s selection: adding a calendar syncs it, removing one clears its events', async () => {
    const { api, store } = await connected()
    await syncCalendars(api, store, NOW, ZONE)
    const family = store.calendars().find((c) => c.summary === 'Family')!
    store.setSelected(family.id, true)
    await syncCalendars(api, store, NOW, ZONE)
    const weekend = store.eventsBetween('2026-10-16', '2026-10-18', ZONE)
    expect(weekend.some((e) => e.title === 'Cottage weekend')).toBe(true)
    store.setSelected(family.id, false)
    expect(store.eventsBetween('2026-10-16', '2026-10-18', ZONE).some((e) => e.title === 'Cottage weekend')).toBe(false)
    // The choice survives the next sync.
    await syncCalendars(api, store, NOW, ZONE)
    expect(store.calendars().find((c) => c.id === family.id)?.selected).toBe(false)
  })

  it('forgets everything on clear (disconnect)', async () => {
    const { api, store } = await connected()
    await syncCalendars(api, store, NOW, ZONE)
    store.clear()
    expect(store.calendars()).toEqual([])
    expect(store.eventsBetween(TODAY, TODAY, ZONE)).toEqual([])
  })
})

describe('secret store', () => {
  it('refuses to store anything when OS encryption is unavailable', () => {
    const secrets = sqliteSecretStore(db, { ...testCipher, available: () => false })
    expect(() => secrets.set('x', 'y')).toThrow(/Secure storage is not available/)
  })
})
