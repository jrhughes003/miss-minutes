import { describe, expect, it } from 'vitest'
import { LocalTaskRepo, memoryStorage } from '../../storage/localRepo'
import { FakeClock } from '../clock'
import { TaskService } from '../tasks/service'
import { applyPlan, busyFromEvents, undoPlan, type BatchStore, type BlockRef, type BlockWriter, type PlanApplyItem, type PlanBatch } from './apply'
import type { PlanDay } from './types'

// Thursday 2026-10-08 in Toronto (UTC-4): 07:00 local = 11:00Z. A meeting 09:00–10:00.
const Z = (hhmm: string) => `2026-10-08T${hhmm}:00.000Z`
const day: PlanDay = { date: '2026-10-08', zone: 'America/Toronto', window: { start: '07:00', end: '22:00' }, busy: [{ start: Z('13:00'), end: Z('14:00') }], notBefore: null }

function setup() {
  const clock = new FakeClock('2026-10-07T15:00:00Z', 'America/Toronto')
  let n = 0
  const tasks = new TaskService(new LocalTaskRepo(memoryStorage()), clock, () => `t${++n}`)
  const saved = new Map<string, PlanBatch>()
  const batches: BatchStore = {
    save: (b) => void saved.set(b.id, structuredClone(b)),
    get: (id) => saved.get(id) ?? null,
    latest: () => [...saved.values()].at(-1) ?? null,
  }
  // A calendar that holds blocks by id; `failAfter` makes the write fail partway.
  const calendar = new Map<string, string>()
  let failAfter = Number.POSITIVE_INFINITY
  const writer: BlockWriter = {
    refFor: (calendarId, batchId, key) => ({ calendarId, eventId: `${batchId}-${key}` }),
    write: (calendarId, batchId, blocks) => {
      for (const b of blocks) {
        if (calendar.size >= failAfter) return Promise.reject(new Error('network down'))
        calendar.set(`${batchId}-${b.key}`, b.title)
      }
      return Promise.resolve()
    },
    remove: (refs: BlockRef[]) => {
      for (const r of refs) calendar.delete(r.eventId) // missing ones are fine
      return Promise.resolve()
    },
  }
  let b = 0
  const deps = { tasks, batches, writer, day, newId: () => `b${++b}`, now: '2026-10-07T15:00:00.000Z' }
  return { tasks, batches, calendar, writer, deps, failAt: (k: number) => (failAfter = k) }
}

const item = (o: Partial<PlanApplyItem> & { key: string; start: string }): PlanApplyItem => ({ taskId: null, title: o.key, minutes: 60, priority: 4, tags: [], ...o })

describe('applyPlan', () => {
  it('creates timed tasks with a reminder, reschedules existing ones, and writes blocks', async () => {
    const { tasks, calendar, deps } = setup()
    const old = tasks.createTask({ title: 'Renew licence', due: { date: '2026-10-08', time: null }, reminders: [{ when: { kind: 'beforeDue', minutes: 60 } }] })
    const r = await applyPlan(
      { date: '2026-10-08', calendarId: 'me', reminderMinutesBefore: 5, items: [item({ key: 'new-0', title: 'Report', start: Z('11:00') }), item({ key: old.id, taskId: old.id, title: old.title, minutes: 30, start: Z('14:00') })] },
      deps,
    )
    expect(r).toEqual({ batchId: 'b1', tasksCreated: 1, tasksUpdated: 1, blocksCreated: 2 })
    const report = tasks.listTasks({ status: 'open' }).find((t) => t.title === 'Report')!
    expect(report.due).toEqual({ date: '2026-10-08', time: '07:00' })
    expect(report.reminders.map((x) => x.when)).toEqual([{ kind: 'beforeDue', minutes: 5 }])
    const moved = tasks.getTask(old.id)!
    expect(moved.due).toEqual({ date: '2026-10-08', time: '10:00' })
    // Its own reminder is kept, and the plan's is added.
    expect(moved.reminders.map((x) => x.when)).toEqual([{ kind: 'beforeDue', minutes: 60 }, { kind: 'beforeDue', minutes: 5 }])
    expect([...calendar.values()].sort()).toEqual(['Renew licence', 'Report'])
  })

  it('refuses a plan that no longer fits the calendar, and writes nothing', async () => {
    const { tasks, batches, calendar, deps } = setup()
    const req = { date: '2026-10-08', calendarId: 'me', reminderMinutesBefore: 5, items: [item({ key: 'new-0', start: Z('13:30') })] }
    await expect(applyPlan(req, deps)).rejects.toThrow(/no longer fits/)
    expect(tasks.listTasks({ status: 'open' })).toEqual([])
    expect(batches.latest()).toBeNull()
    expect(calendar.size).toBe(0)
  })

  it('checks every task still exists before creating anything', async () => {
    const { tasks, batches, deps } = setup()
    const req = { date: '2026-10-08', calendarId: null, reminderMinutesBefore: null, items: [item({ key: 'new-0', start: Z('11:00') }), item({ key: 'gone', taskId: 'gone', title: 'Deleted task', start: Z('15:00') })] }
    await expect(applyPlan(req, deps)).rejects.toThrow('"Deleted task" no longer exists.')
    expect(tasks.listTasks({ status: 'open' })).toEqual([])
    expect(batches.latest()).toBeNull()
  })

  it('can undo a plan whose block write failed halfway', async () => {
    const { tasks, batches, calendar, deps, failAt } = setup()
    failAt(1)
    const req = { date: '2026-10-08', calendarId: 'me', reminderMinutesBefore: 5, items: [item({ key: 'new-0', start: Z('11:00') }), item({ key: 'new-1', start: Z('15:00') })] }
    await expect(applyPlan(req, deps)).rejects.toThrow('network down')
    expect(calendar.size).toBe(1)
    await undoPlan(batches.latest()!.id, deps)
    expect(calendar.size).toBe(0)
    expect(tasks.listTasks({ status: 'open' })).toEqual([])
  })
})

describe('undoPlan', () => {
  it('restores rescheduled tasks, deletes created ones and removes blocks, once', async () => {
    const { tasks, batches, calendar, deps } = setup()
    const old = tasks.createTask({ title: 'Renew licence', due: { date: '2026-10-09', time: null }, estimateMinutes: 20 })
    const { batchId } = await applyPlan(
      { date: '2026-10-08', calendarId: 'me', reminderMinutesBefore: 5, items: [item({ key: 'new-0', start: Z('11:00') }), item({ key: old.id, taskId: old.id, title: old.title, minutes: 30, start: Z('15:00') })] },
      deps,
    )
    await undoPlan(batchId, deps)
    expect(tasks.listTasks({ status: 'open' }).map((t) => t.title)).toEqual(['Renew licence'])
    const back = tasks.getTask(old.id)!
    expect([back.due, back.estimateMinutes, back.reminders]).toEqual([{ date: '2026-10-09', time: null }, 20, []])
    expect(calendar.size).toBe(0)
    expect(batches.get(batchId)!.undone).toBe(true)
    await undoPlan(batchId, deps) // a second click changes nothing
    expect(tasks.listTasks({ status: 'open' })).toHaveLength(1)
  })

  it('says so when a plan can no longer be undone', async () => {
    const { deps } = setup()
    await expect(undoPlan('nope', deps)).rejects.toThrow('That plan can no longer be undone.')
  })
})

describe('busyFromEvents', () => {
  it('counts timed, opaque events only', () => {
    const t = { allDay: false, start: Z('13:00'), end: Z('14:00') }
    expect(busyFromEvents([t, { ...t, transparent: true }, { allDay: true, start: '2026-10-08', end: '2026-10-09' }])).toEqual([{ start: Z('13:00'), end: Z('14:00') }])
  })
})
