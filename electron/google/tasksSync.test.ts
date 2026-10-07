// Google Tasks two-way sync end to end: the real sync code, SQLite and
// TaskService, against the local fake Google server. "Phone" edits go
// straight into the fake (fake.tasks.*), the way the Google Tasks app would.
// No request in this file reaches Google.

import fc from 'fast-check'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../../src/core/clock'
import { fromGoogleTask } from '../../src/core/sync/googleTasks'
import { sameFields } from '../../src/core/sync/tasksMerge'
import { TaskService } from '../../src/core/tasks/service'
import { openDatabase, type SqlDatabase } from '../db/database'
import { migrate } from '../db/migrations'
import { SqliteTaskRepo } from '../db/taskRepo'
import { GoogleApi } from './api'
import { GoogleAuth } from './auth'
import { FAKE_CLIENT, startFakeGoogle, type FakeGoogle } from './fakeGoogle'
import { sqliteSecretStore } from './secrets'
import { fromLocal, syncTasks } from './tasksSync'
import { TasksSyncStore } from './tasksSyncStore'

const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'
const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() }

let fake: FakeGoogle
let db: SqlDatabase
let tasks: TaskService
let store: TasksSyncStore
let api: GoogleApi
const clock = new FakeClock('2026-10-07T14:00:00Z', 'America/Toronto')
const sync = () => syncTasks(api, store, tasks, clock)
const phone = () => fake.tasks
const inbox = () => fake.tasks.defaultListId
const remoteOpen = (listId = inbox()) => phone().all(listId).filter((t) => !t.deleted)
const byTitle = (title: string, listId = inbox()) => remoteOpen(listId).find((t) => t.title === title)!

beforeEach(async () => {
  fake = await startFakeGoogle({ today: '2026-10-07', zone: 'America/Toronto' })
  db = openDatabase(':memory:')
  migrate(db)
  tasks = new TaskService(new SqliteTaskRepo(db), clock, randomUUID)
  store = new TasksSyncStore(db)
  const auth = new GoogleAuth({ fetch, endpoints: fake.endpoints, secrets: sqliteSecretStore(db, cipher), openBrowser: (u) => fake.consent(u) })
  auth.importClient(JSON.stringify({ installed: { client_id: FAKE_CLIENT.clientId, client_secret: FAKE_CLIENT.clientSecret } }))
  await auth.connect([TASKS_SCOPE])
  api = new GoogleApi({ fetch, endpoints: fake.endpoints, auth, sleep: async () => {} })
})
afterEach(async () => {
  await fake.close()
  db.close()
})

describe('first sync', () => {
  it('sends open local tasks and brings open Google tasks in, but leaves completed history alone', async () => {
    tasks.createTask({ title: 'Local open' })
    tasks.completeTask(tasks.createTask({ title: 'Local done long ago' }).id)
    phone().create(inbox(), { title: 'Phone open', due: '2026-10-09' })
    phone().create(inbox(), { title: 'Phone done', status: 'completed' })
    const r = await sync()
    expect(r).toMatchObject({ pushed: 1, pulled: 1 })
    expect(remoteOpen().map((t) => t.title).sort()).toEqual(['Local open', 'Phone done', 'Phone open'])
    expect(tasks.listTasks({ status: 'all' }).map((t) => t.title).sort()).toEqual(['Local done long ago', 'Local open', 'Phone open'])
    expect(tasks.listTasks().find((t) => t.title === 'Phone open')?.due).toEqual({ date: '2026-10-09', time: null })
  })

  it('maps projects to lists, matching by name and creating what is missing', async () => {
    const work = tasks.createProject('Work')
    tasks.createTask({ title: 'Report', projectId: work.id })
    const groceries = phone().createList('Groceries')
    phone().create(groceries.id, { title: 'Milk' })
    const errands = phone().createList('errands')
    const local = tasks.createProject('Errands')
    tasks.createTask({ title: 'Post office', projectId: local.id })
    await sync()
    const workList = phone().lists().find((l) => l.title === 'Work')!
    expect(remoteOpen(workList.id).map((t) => t.title)).toEqual(['Report'])
    expect(remoteOpen(errands.id).map((t) => t.title)).toEqual(['Post office']) // matched by name, not duplicated
    const groceriesProject = tasks.listProjects().find((p) => p.name === 'Groceries')!
    expect(tasks.listTasks({ projectId: groceriesProject.id }).map((t) => t.title)).toEqual(['Milk'])
  })

  it('is idempotent: a second sync with no changes changes nothing', async () => {
    tasks.createTask({ title: 'One' })
    await sync()
    const before = fake.requests.length
    expect(await sync()).toEqual({ pulled: 0, pushed: 0, updated: 0, deleted: 0, conflicts: 0 })
    expect(fake.requests.slice(before).every((r) => r.method === 'GET')).toBe(true)
  })
})

describe('edits', () => {
  it('keeps both edits when they touch different fields', async () => {
    const t = tasks.createTask({ title: 'Call dentist', due: { date: '2026-10-08', time: '15:00' } })
    await sync()
    phone().edit(inbox(), byTitle('Call dentist').id, { title: 'Call dentist re: crown' })
    tasks.updateTask(t.id, { notes: 'Ask about the bill' })
    await sync()
    expect(tasks.getTask(t.id)).toMatchObject({ title: 'Call dentist re: crown', notes: 'Ask about the bill' })
    expect(byTitle('Call dentist re: crown').notes).toBe('Ask about the bill')
  })

  it('keeps our time of day when the date changes in Google (which has no times)', async () => {
    const t = tasks.createTask({ title: 'Standup', due: { date: '2026-10-08', time: '09:30' } })
    await sync()
    phone().edit(inbox(), byTitle('Standup').id, { due: '2026-10-09T00:00:00.000Z' })
    await sync()
    expect(tasks.getTask(t.id)?.due).toEqual({ date: '2026-10-09', time: '09:30' })
  })

  it('on a same-field conflict keeps ours, sends it to Google, and logs what Google had', async () => {
    const t = tasks.createTask({ title: 'Original' })
    await sync()
    phone().edit(inbox(), byTitle('Original').id, { title: 'Phone title' })
    tasks.updateTask(t.id, { title: 'PC title' })
    const r = await sync()
    expect(r.conflicts).toBe(1)
    expect(tasks.getTask(t.id)?.title).toBe('PC title')
    expect(remoteOpen().map((x) => x.title)).toEqual(['PC title'])
    expect(store.recentLog()[0]).toMatchObject({ kind: 'conflict', detail: expect.stringContaining('Phone title') })
  })

  it('completing a repeating task in Google completes it here and sends the next occurrence', async () => {
    const t = tasks.createTask({ title: 'Bins', due: { date: '2026-10-07', time: null }, recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY' } })
    await sync()
    phone().edit(inbox(), byTitle('Bins').id, { status: 'completed' })
    await sync()
    expect(tasks.getTask(t.id)?.status).toBe('done')
    const next = tasks.listTasks().find((x) => x.title === 'Bins')!
    expect(next.due?.date).toBe('2026-10-14')
    expect(remoteOpen().filter((x) => x.title === 'Bins' && x.status === 'needsAction').map((x) => x.due)).toEqual(['2026-10-14T00:00:00.000Z'])
  })

  it('moves a task to another list when its project changes here', async () => {
    const t = tasks.createTask({ title: 'Movable' })
    await sync()
    const p = tasks.createProject('Home')
    tasks.updateTask(t.id, { projectId: p.id })
    await sync()
    const home = phone().lists().find((l) => l.title === 'Home')!
    expect(remoteOpen(home.id).map((x) => x.title)).toEqual(['Movable'])
    expect(remoteOpen().some((x) => x.title === 'Movable')).toBe(false)
  })

  it('syncs subtasks both ways', async () => {
    const parent = tasks.createTask({ title: 'Move house' })
    tasks.createTask({ title: 'Book van', parentId: parent.id })
    await sync()
    expect(byTitle('Book van').parent).toBe(byTitle('Move house').id)
    phone().create(inbox(), { title: 'Pack books' }, byTitle('Move house').id)
    await sync()
    expect(tasks.subtasksOf(parent.id).map((s) => s.title).sort()).toEqual(['Book van', 'Pack books'])
  })
})

describe('deletions (D31)', () => {
  it('deleted in Google and untouched here → deleted here', async () => {
    const t = tasks.createTask({ title: 'Gone' })
    await sync()
    phone().remove(inbox(), byTitle('Gone').id)
    await sync()
    expect(tasks.getTask(t.id)).toBeNull()
  })

  it('deleted in Google but edited here → kept, and created in Google again', async () => {
    const t = tasks.createTask({ title: 'Precious' })
    await sync()
    phone().remove(inbox(), byTitle('Precious').id)
    tasks.updateTask(t.id, { notes: 'important edit' })
    await sync()
    expect(tasks.getTask(t.id)?.notes).toBe('important edit')
    expect(byTitle('Precious').notes).toBe('important edit')
    expect(store.recentLog().some((l) => l.kind === 'restored-remote')).toBe(true)
  })

  it('deleted here and untouched in Google → deleted in Google', async () => {
    const t = tasks.createTask({ title: 'Bye' })
    await sync()
    tasks.deleteTask(t.id)
    await sync()
    expect(remoteOpen().some((x) => x.title === 'Bye')).toBe(false)
  })

  it('deleted here but edited in Google → brought back here', async () => {
    const t = tasks.createTask({ title: 'Back' })
    await sync()
    phone().edit(inbox(), byTitle('Back').id, { notes: 'edited on phone' })
    tasks.deleteTask(t.id)
    await sync()
    expect(tasks.listTasks().find((x) => x.title === 'Back')?.notes).toBe('edited on phone')
  })

  it('treats completing as completing, not deleting', async () => {
    const t = tasks.createTask({ title: 'Finish me' })
    await sync()
    phone().edit(inbox(), byTitle('Finish me').id, { status: 'completed', hidden: true })
    await sync()
    expect(tasks.getTask(t.id)?.status).toBe('done')
  })
})

describe('reliability', () => {
  it('adopts the task an ambiguous upload created instead of uploading a duplicate', async () => {
    tasks.createTask({ title: 'Only once' })
    phone().failNextInsertAfterSaving()
    await sync() // Google saved it but answered 500
    expect(store.outbox()).toHaveLength(1)
    await sync()
    expect(remoteOpen().filter((x) => x.title === 'Only once')).toHaveLength(1)
    expect(store.outbox()).toHaveLength(0)
    expect(store.recentLog().some((l) => l.kind === 'adopted')).toBe(true)
  })

  it('stops syncing a project whose Google list was deleted, keeping its tasks and not re-creating the list', async () => {
    const p = tasks.createProject('Side project')
    const t = tasks.createTask({ title: 'Keep me', projectId: p.id })
    await sync()
    phone().deleteList(phone().lists().find((l) => l.title === 'Side project')!.id)
    await sync()
    tasks.createTask({ title: 'Added later', projectId: p.id })
    await sync()
    expect(tasks.getTask(t.id)).not.toBeNull()
    expect(phone().lists().some((l) => l.title === 'Side project')).toBe(false)
    expect(store.recentLog().some((l) => l.kind === 'list')).toBe(true)
  })
})

describe('property: random edits on both sides converge', () => {
  type Op =
    | { side: 'local' | 'phone'; kind: 'create'; title: string }
    | { side: 'local' | 'phone'; kind: 'rename' | 'complete' | 'reopen' | 'delete' | 'redate'; pick: number; title: string; day: number }

  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ side: fc.constantFrom('local' as const, 'phone' as const), kind: fc.constant('create' as const), title: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `T-${s.replace(/\s/g, '_')}`) }),
    fc.record({
      side: fc.constantFrom('local' as const, 'phone' as const),
      kind: fc.constantFrom('rename' as const, 'complete' as const, 'reopen' as const, 'delete' as const, 'redate' as const),
      pick: fc.nat(20),
      title: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `R-${s.replace(/\s/g, '_')}`),
      day: fc.integer({ min: 1, max: 28 }),
    }),
  )

  it('after two syncs both sides agree, with nothing duplicated', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.array(op, { maxLength: 6 }), { minLength: 1, maxLength: 4 }), async (rounds) => {
        // Fresh state for each run.
        db.exec('DELETE FROM gtasks_map; DELETE FROM gtasks_lists; DELETE FROM gtasks_outbox; DELETE FROM tasks; DELETE FROM projects;')
        for (const t of phone().all(inbox())) if (!t.deleted) phone().remove(inbox(), t.id)

        for (const round of rounds) {
          for (const o of round) {
            const localOpen = tasks.listTasks({ status: 'all' })
            const remote = phone().all(inbox()).filter((t) => !t.deleted)
            if (o.kind === 'create') {
              if (o.side === 'local') tasks.createTask({ title: o.title })
              else phone().create(inbox(), { title: o.title })
              continue
            }
            if (o.side === 'local') {
              const t = localOpen[o.pick % Math.max(localOpen.length, 1)]
              if (!t) continue
              if (o.kind === 'rename') tasks.updateTask(t.id, { title: o.title })
              if (o.kind === 'complete') tasks.completeTask(t.id)
              if (o.kind === 'reopen') tasks.reopenTask(t.id)
              if (o.kind === 'delete') tasks.deleteTask(t.id)
              if (o.kind === 'redate') tasks.updateTask(t.id, { due: { date: `2026-11-${String(o.day).padStart(2, '0')}`, time: null } })
            } else {
              const t = remote[o.pick % Math.max(remote.length, 1)]
              if (!t) continue
              if (o.kind === 'rename') phone().edit(inbox(), t.id, { title: o.title })
              if (o.kind === 'complete') phone().edit(inbox(), t.id, { status: 'completed' })
              if (o.kind === 'reopen') phone().edit(inbox(), t.id, { status: 'needsAction' })
              if (o.kind === 'delete') phone().remove(inbox(), t.id)
              if (o.kind === 'redate') phone().edit(inbox(), t.id, { due: `2026-11-${String(o.day).padStart(2, '0')}T00:00:00.000Z` })
            }
          }
          await sync()
        }
        await sync()

        // Every mapping points at a live pair whose shared fields agree.
        const remoteById = new Map(phone().all(inbox()).map((t) => [t.id, t]))
        for (const m of store.mappings()) {
          const local = tasks.getTask(m.localId)
          const remote = remoteById.get(m.googleId)
          expect(local, 'mapped local task exists').not.toBeNull()
          expect(remote && !remote.deleted, 'mapped Google task exists').toBe(true)
          expect(sameFields(fromLocal(local!), fromGoogleTask(remote!))).toBe(true)
        }
        // No open task on either side is left unsynced, and none is mapped twice.
        const mappedLocal = new Set(store.mappings().map((m) => m.localId))
        const mappedRemote = new Set(store.mappings().map((m) => m.googleId))
        expect(tasks.listTasks({ status: 'open' }).every((t) => mappedLocal.has(t.id))).toBe(true)
        expect([...remoteById.values()].filter((t) => !t.deleted && t.status !== 'completed').every((t) => mappedRemote.has(t.id))).toBe(true)
        expect(mappedRemote.size).toBe(store.mappings().length)
      }),
      { numRuns: Number(process.env.MM_PROPERTY_RUNS ?? 150) }, // MM_PROPERTY_RUNS=500 for a deeper run
    )
  }, 120_000)
})
