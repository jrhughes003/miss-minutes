import { beforeEach, describe, expect, it } from 'vitest'
import { LocalTaskRepo, memoryStorage } from '../../storage/localRepo'
import { FakeClock, HOUR } from '../clock'
import { ValidationError } from './normalize'
import { compareTasks, NotFoundError, TaskService } from './service'
import type { Task } from './types'

let clock: FakeClock
let service: TaskService

function makeService() {
  let n = 0
  clock = new FakeClock('2026-10-06T14:00:00Z', 'America/Toronto') // 10:00 local, a Tuesday
  service = new TaskService(new LocalTaskRepo(memoryStorage()), clock, () => `id${++n}`)
}

beforeEach(makeService)

describe('creating tasks', () => {
  it('applies defaults and normalizes input', () => {
    const t = service.createTask({ title: '  Buy milk  ', tags: ['#Errands', 'errands', ' Food '] })
    expect(t).toMatchObject({
      id: 'id1',
      title: 'Buy milk',
      notes: '',
      projectId: null,
      tags: ['errands', 'food'],
      priority: 4,
      due: null,
      status: 'open',
      createdAt: '2026-10-06T14:00:00.000Z',
    })
  })

  it('rejects bad input with the field that was wrong', () => {
    const fieldOf = (fn: () => unknown) => {
      try {
        fn()
      } catch (e) {
        return e instanceof ValidationError ? e.field : `not a ValidationError: ${String(e)}`
      }
      return 'no error'
    }
    expect(fieldOf(() => service.createTask({ title: '   ' }))).toBe('title')
    expect(fieldOf(() => service.createTask({ title: 'x'.repeat(1025) }))).toBe('title')
    expect(fieldOf(() => service.createTask({ title: 'x', due: { date: '2026-02-30', time: null } }))).toBe('due')
    expect(fieldOf(() => service.createTask({ title: 'x', due: { date: '2026-10-07', time: '9am' } }))).toBe('due')
    expect(fieldOf(() => service.createTask({ title: 'x', priority: 7 as never }))).toBe('priority')
    expect(fieldOf(() => service.createTask({ title: 'x', estimateMinutes: 0 }))).toBe('estimateMinutes')
    expect(fieldOf(() => service.createTask({ title: 'x', tags: ['has space'] }))).toBe('tags')
    expect(fieldOf(() => service.createTask({ title: 'x', projectId: 'missing' }))).toBe('projectId')
    expect(fieldOf(() => service.createTask({ title: 'x', recurrence: { kind: 'rule', rrule: 'FREQ=DAILY' } }))).toBe('recurrence') // no due date
  })

  it('normalizes repeat rules', () => {
    const t = service.createTask({ title: 'x', due: { date: '2026-10-06', time: null }, recurrence: { kind: 'rule', rrule: 'rrule:freq=daily' } })
    expect(t.recurrence).toEqual({ kind: 'rule', rrule: 'FREQ=DAILY' })
  })

  it('puts subtasks in their parent’s project and allows only one level', () => {
    const p = service.createProject('Home')
    const parent = service.createTask({ title: 'Paint room', projectId: p.id })
    const sub = service.createTask({ title: 'Buy paint', parentId: parent.id, projectId: null })
    expect(sub.projectId).toBe(p.id)
    expect(() => service.createTask({ title: 'Too deep', parentId: sub.id })).toThrow(/one level/)
    expect(() =>
      service.createTask({ title: 'x', parentId: parent.id, due: { date: '2026-10-06', time: null }, recurrence: { kind: 'rule', rrule: 'FREQ=DAILY' } }),
    ).toThrow(/cannot repeat/)
  })

  it('appends new tasks to the end of their list', () => {
    const a = service.createTask({ title: 'a' })
    const b = service.createTask({ title: 'b' })
    expect(b.order).toBeGreaterThan(a.order)
  })
})

describe('updating tasks', () => {
  it('changes only the given fields and bumps updatedAt', () => {
    const t = service.createTask({ title: 'Draft', priority: 3, tags: ['a'] })
    clock.advance(HOUR)
    const u = service.updateTask(t.id, { title: 'Final', priority: 1 })
    expect(u).toMatchObject({ title: 'Final', priority: 1, tags: ['a'], createdAt: t.createdAt, updatedAt: '2026-10-06T15:00:00.000Z' })
  })

  it('refuses to remove the due date from a repeating task', () => {
    const t = service.createTask({ title: 'x', due: { date: '2026-10-06', time: null }, recurrence: { kind: 'rule', rrule: 'FREQ=DAILY' } })
    expect(() => service.updateTask(t.id, { due: null })).toThrow(/needs a due date/)
    // Removing both together is fine.
    expect(service.updateTask(t.id, { due: null, recurrence: null }).recurrence).toBeNull()
  })

  it('moves subtasks along when the parent changes project', () => {
    const work = service.createProject('Work')
    const parent = service.createTask({ title: 'Report' })
    const sub = service.createTask({ title: 'Outline', parentId: parent.id })
    service.updateTask(parent.id, { projectId: work.id })
    expect(service.getTask(sub.id)?.projectId).toBe(work.id)
    expect(() => service.updateTask(sub.id, { projectId: null })).toThrow(/parent/)
  })

  it('accepts a manual order and rejects a non-number', () => {
    const t = service.createTask({ title: 'x' })
    expect(service.updateTask(t.id, { order: 0.5 }).order).toBe(0.5)
    expect(() => service.updateTask(t.id, { order: Number.NaN })).toThrow(/Order/)
  })

  it('reports a missing task clearly', () => {
    expect(() => service.updateTask('ghost', { title: 'x' })).toThrow(NotFoundError)
  })
})

describe('completing tasks', () => {
  it('marks a one-off task done, and is idempotent', () => {
    const t = service.createTask({ title: 'Once' })
    const first = service.completeTask(t.id)
    expect(first.completed).toMatchObject({ status: 'done', completedAt: '2026-10-06T14:00:00.000Z' })
    expect(first.next).toBeNull()
    clock.advance(HOUR)
    const second = service.completeTask(t.id)
    expect(second.completed.completedAt).toBe('2026-10-06T14:00:00.000Z') // unchanged
    expect(service.listTasks({ status: 'all' })).toHaveLength(1)
  })

  it('completes open subtasks with the parent', () => {
    const parent = service.createTask({ title: 'Trip' })
    const s1 = service.createTask({ title: 'Pack', parentId: parent.id })
    service.completeTask(parent.id)
    expect(service.getTask(s1.id)?.status).toBe('done')
  })

  it('creates the next occurrence of a repeating task, keeping the done copy as history', () => {
    const t = service.createTask({
      title: 'Water plants',
      due: { date: '2026-10-06', time: '18:00' },
      recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY;BYDAY=TU' },
      tags: ['home'],
      priority: 2,
    })
    const { completed, next } = service.completeTask(t.id)
    expect(completed.status).toBe('done')
    expect(next).toMatchObject({ title: 'Water plants', due: { date: '2026-10-13', time: '18:00' }, status: 'open', tags: ['home'], priority: 2 })
    expect(next!.id).not.toBe(t.id)
    expect(service.listTasks().map((x) => x.id)).toEqual([next!.id])
  })

  it('copies subtasks to the next occurrence as open', () => {
    const t = service.createTask({ title: 'Weekly review', due: { date: '2026-10-06', time: null }, recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY' } })
    service.createTask({ title: 'Inbox zero', parentId: t.id })
    service.createTask({ title: 'Plan week', parentId: t.id })
    const { next } = service.completeTask(t.id)
    const subs = service.subtasksOf(next!.id)
    expect(subs.map((s) => [s.title, s.status])).toEqual([['Inbox zero', 'open'], ['Plan week', 'open']])
  })

  it('uses the user’s local date, not the UTC date, to decide what "today" is', () => {
    // 01:00 UTC on Oct 7 is still 21:00 on Oct 6 in Toronto.
    clock.set('2026-10-07T01:00:00Z')
    const t = service.createTask({ title: 'Daily', due: { date: '2026-09-01', time: null }, recurrence: { kind: 'rule', rrule: 'FREQ=DAILY' } })
    expect(service.completeTask(t.id).next?.due).toEqual({ date: '2026-10-06', time: null })
  })

  it('reopens a done task', () => {
    const t = service.createTask({ title: 'x' })
    service.completeTask(t.id)
    expect(service.reopenTask(t.id)).toMatchObject({ status: 'open', completedAt: null })
  })
})

describe('deleting', () => {
  it('deletes a task with its subtasks, idempotently', () => {
    const parent = service.createTask({ title: 'p' })
    service.createTask({ title: 's', parentId: parent.id })
    service.deleteTask(parent.id)
    expect(service.listTasks({ status: 'all', includeSubtasks: true })).toEqual([])
    expect(() => service.deleteTask(parent.id)).not.toThrow()
  })

  it('moves a deleted project’s tasks to the Inbox', () => {
    const p = service.createProject('Old')
    const t = service.createTask({ title: 'Keep me', projectId: p.id })
    service.deleteProject(p.id)
    expect(service.getTask(t.id)?.projectId).toBeNull()
    expect(service.listProjects()).toEqual([])
  })
})

describe('projects and tags', () => {
  it('rejects duplicate names case-insensitively, including on rename', () => {
    service.createProject('Home')
    const work = service.createProject('Work')
    expect(() => service.createProject('home')).toThrow(/already exists/)
    expect(() => service.renameProject(work.id, 'HOME')).toThrow(/already exists/)
    expect(service.renameProject(work.id, 'Day job').name).toBe('Day job')
  })

  it('assigns colours and keeps creation order', () => {
    const a = service.createProject('A')
    const b = service.createProject('B', '#123ABC')
    expect(a.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(b.color).toBe('#123abc')
    expect(service.listProjects().map((p) => p.name)).toEqual(['A', 'B'])
  })

  it('lists tags in use', () => {
    service.createTask({ title: 'a', tags: ['b', 'a'] })
    service.createTask({ title: 'b', tags: ['c', 'a'] })
    expect(service.listTags()).toEqual(['a', 'b', 'c'])
  })
})

describe('listing', () => {
  it('filters by status, project, tag and text, hiding subtasks by default', () => {
    const home = service.createProject('Home')
    const a = service.createTask({ title: 'Fix sink', projectId: home.id, tags: ['diy'] })
    service.createTask({ title: 'Email Sam', notes: 'about the SINK' })
    service.createTask({ title: 'Sub', parentId: a.id })
    const done = service.createTask({ title: 'Old' })
    service.completeTask(done.id)

    expect(service.listTasks().map((t) => t.title).sort()).toEqual(['Email Sam', 'Fix sink'])
    expect(service.listTasks({ projectId: home.id }).map((t) => t.title)).toEqual(['Fix sink'])
    expect(service.listTasks({ projectId: null }).map((t) => t.title)).toEqual(['Email Sam'])
    expect(service.listTasks({ tag: '#DIY' }).map((t) => t.title)).toEqual(['Fix sink'])
    expect(service.listTasks({ search: 'sink' })).toHaveLength(2)
    expect(service.listTasks({ status: 'done' }).map((t) => t.title)).toEqual(['Old'])
    expect(service.listTasks({ includeSubtasks: true })).toHaveLength(3)
  })
})

describe('compareTasks', () => {
  const base = (o: Partial<Task>): Task => ({
    id: 'x', title: 'x', notes: '', projectId: null, tags: [], priority: 4, due: null, estimateMinutes: null,
    recurrence: null, reminders: [], parentId: null, status: 'open', completedAt: null, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', order: 0, ...o,
  })

  it('orders by due date, all-day first, then time, then priority, with undated last and done at the end', () => {
    const list = [
      base({ id: 'undated-p1', priority: 1 }),
      base({ id: 'done', status: 'done', completedAt: '2026-01-02T00:00:00Z' }),
      base({ id: 'tue-0900', due: { date: '2026-10-06', time: '09:00' } }),
      base({ id: 'tue-allday', due: { date: '2026-10-06', time: null } }),
      base({ id: 'mon-p4', due: { date: '2026-10-05', time: null } }),
      base({ id: 'tue-0900-p1', due: { date: '2026-10-06', time: '09:00' }, priority: 1 }),
    ]
    expect(list.sort(compareTasks).map((t) => t.id)).toEqual(['mon-p4', 'tue-allday', 'tue-0900-p1', 'tue-0900', 'undated-p1', 'done'])
  })
})
