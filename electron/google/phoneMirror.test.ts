// Phone reminders end to end against the fake Google server. No request reaches Google.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../../src/core/clock'
import { TaskService } from '../../src/core/tasks/service'
import { openDatabase, type SqlDatabase } from '../db/database'
import { migrate } from '../db/migrations'
import { sqliteSettingsStore } from '../db/settingsStore'
import { SqliteTaskRepo } from '../db/taskRepo'
import { GoogleApi, GoogleApiError } from './api'
import { GoogleAuth } from './auth'
import { FAKE_CLIENT, startFakeGoogle, type FakeGoogle } from './fakeGoogle'
import { APP_CALENDAR_SCOPE, CALENDAR_READ_SCOPES } from './oauth'
import { PHONE_CALENDAR_NAME, PhoneMirror, phoneEventBody, phoneEventId } from './phoneMirror'
import { sqliteSecretStore } from './secrets'

const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() }
let fake: FakeGoogle
let db: SqlDatabase
let tasks: TaskService
let api: GoogleApi
let mirror: PhoneMirror
const clock = new FakeClock('2026-10-07T14:00:00Z', 'America/Toronto')

async function setup(scopes: string[]) {
  const auth = new GoogleAuth({ fetch, endpoints: fake.endpoints, secrets: sqliteSecretStore(db, cipher), openBrowser: (u) => fake.consent(u) })
  auth.importClient(JSON.stringify({ installed: { client_id: FAKE_CLIENT.clientId, client_secret: FAKE_CLIENT.clientSecret } }))
  await auth.connect(scopes)
  api = new GoogleApi({ fetch, endpoints: fake.endpoints, auth, sleep: async () => {} })
  mirror = new PhoneMirror({ api, db, tasks, clock, settings: sqliteSettingsStore(db), allDayTime: () => '09:00' })
}
const phoneCalendar = () => fake.calendarList().find((c) => c.summary === PHONE_CALENDAR_NAME)!
const phoneEvents = () => fake.calendarEvents(phoneCalendar().id)

beforeEach(async () => {
  fake = await startFakeGoogle({ today: '2026-10-07', zone: 'America/Toronto' })
  db = openDatabase(':memory:')
  migrate(db)
  tasks = new TaskService(new SqliteTaskRepo(db), clock, randomUUID)
})
afterEach(async () => {
  await fake.close()
  db.close()
})

const addTask = (title = 'Dentist', phone = true) =>
  tasks.createTask({ title, due: { date: '2026-10-08', time: '15:00' }, reminders: [{ when: { kind: 'beforeDue', minutes: 15 }, phone }] })

describe('PhoneMirror', () => {
  it('creates its own calendar and one event per 📱 reminder, with a popup at the reminder time', async () => {
    await setup([...CALENDAR_READ_SCOPES, APP_CALENDAR_SCOPE])
    addTask()
    addTask('Not for the phone', false)
    expect(await mirror.sync()).toEqual({ created: 1, updated: 0, deleted: 0 })
    const [e] = phoneEvents()
    expect(e).toMatchObject({
      summary: '⏰ Dentist',
      start: { dateTime: '2026-10-08T18:45:00.000Z', timeZone: 'America/Toronto' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
      transparency: 'transparent',
    })
  })

  it('is idempotent: a second run writes nothing', async () => {
    await setup([...CALENDAR_READ_SCOPES, APP_CALENDAR_SCOPE])
    addTask()
    await mirror.sync()
    const writes = fake.calendarWrites.length
    expect(await mirror.sync()).toEqual({ created: 0, updated: 0, deleted: 0 })
    expect(fake.calendarWrites.length).toBe(writes)
  })

  it('updates the event when the task changes, and removes it when the task is done', async () => {
    await setup([...CALENDAR_READ_SCOPES, APP_CALENDAR_SCOPE])
    const t = addTask()
    await mirror.sync()
    tasks.updateTask(t.id, { title: 'Dentist (crown)' })
    expect((await mirror.sync()).updated).toBe(1)
    expect(phoneEvents()[0]!.summary).toBe('⏰ Dentist (crown)')
    tasks.completeTask(t.id)
    expect((await mirror.sync()).deleted).toBe(1)
    expect(phoneEvents()).toEqual([])
  })

  it('moving the due time replaces the event (a new occurrence has a new id)', async () => {
    await setup([...CALENDAR_READ_SCOPES, APP_CALENDAR_SCOPE])
    const t = addTask()
    await mirror.sync()
    tasks.updateTask(t.id, { due: { date: '2026-10-09', time: '10:00' } })
    expect(await mirror.sync()).toEqual({ created: 1, updated: 0, deleted: 1 })
    expect(phoneEvents().map((e) => e.start?.dateTime)).toEqual(['2026-10-09T13:45:00.000Z'])
  })

  it('never duplicates: an event that already exists (a crash before saving) is updated, not created twice', async () => {
    await setup([...CALENDAR_READ_SCOPES, APP_CALENDAR_SCOPE])
    const t = addTask()
    await mirror.sync()
    db.exec('DELETE FROM phone_events') // forget that we created it, as if we crashed before recording it
    tasks.updateTask(t.id, { title: 'Dentist again' })
    await mirror.sync()
    expect(phoneEvents()).toHaveLength(1)
    expect(phoneEvents()[0]!.summary).toBe('⏰ Dentist again')
  })

  it('only ever writes to its own calendar', async () => {
    await setup([...CALENDAR_READ_SCOPES, APP_CALENDAR_SCOPE])
    addTask()
    await mirror.sync()
    expect(new Set(fake.calendarWrites.map((w) => w.calendarId))).toEqual(new Set([phoneCalendar().id]))
  })

  it('cannot create the calendar without the app.created scope', async () => {
    await setup([...CALENDAR_READ_SCOPES])
    addTask()
    await expect(mirror.sync()).rejects.toBeInstanceOf(GoogleApiError)
  })

  it('removes everything when phone reminders are turned off', async () => {
    await setup([...CALENDAR_READ_SCOPES, APP_CALENDAR_SCOPE])
    addTask()
    addTask('Second')
    await mirror.sync()
    await mirror.removeAll()
    expect(phoneEvents()).toEqual([])
  })

  it('makes valid, stable Google event ids', () => {
    const id = phoneEventId('r1', '2026-10-08T14:45')
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/)
    expect(id).toBe(phoneEventId('r1', '2026-10-08T14:45'))
    expect(id).not.toBe(phoneEventId('r1', '2026-10-15T14:45'))
    expect(phoneEventBody({ ruleId: 'r1', occurrence: 'x', taskId: 't', title: 'A', start: new Date(0) }, 'UTC').end?.dateTime).toBe('1970-01-01T00:15:00.000Z')
  })
})
