// One test suite that every TaskRepo implementation must pass. SQLite (desktop)
// and localStorage (web demo) run the same assertions, so the two storage
// paths can't quietly behave differently.

import { describe, expect, it } from 'vitest'
import type { Project, Task, TaskRepo } from '../core/tasks/types'

export function sampleTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Call the dentist ☎️ — "urgent"',
    notes: 'Line one\nLine two',
    projectId: null,
    tags: ['health', 'phone'],
    priority: 2,
    due: { date: '2026-10-08', time: '13:30' },
    estimateMinutes: 15,
    recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY;BYDAY=TH' },
    reminders: [
      { id: 'r1', when: { kind: 'beforeDue', minutes: 15 }, phone: true, scheduledAt: '2026-10-06T12:00:00.000Z' },
      { id: 'r2', when: { kind: 'at', date: '2026-10-07', time: '08:00' }, phone: false, scheduledAt: '2026-10-06T12:00:00.000Z' },
    ],
    parentId: null,
    status: 'open',
    completedAt: null,
    createdAt: '2026-10-06T12:00:00.000Z',
    updatedAt: '2026-10-06T12:00:00.000Z',
    order: 1,
    ...overrides,
  }
}

export function sampleProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Home',
    color: '#2f5fa7',
    order: 1,
    createdAt: '2026-10-06T12:00:00.000Z',
    updatedAt: '2026-10-06T12:00:00.000Z',
    ...overrides,
  }
}

export function taskRepoContract(name: string, makeRepo: () => TaskRepo): void {
  describe(`TaskRepo contract: ${name}`, () => {
    it('round-trips every task field exactly', () => {
      const repo = makeRepo()
      repo.putProject(sampleProject())
      const task = sampleTask({ projectId: 'p1' })
      repo.putTask(task)
      expect(repo.getTask('t1')).toEqual(task)
    })

    it('round-trips null and empty values', () => {
      const repo = makeRepo()
      const task = sampleTask({ notes: '', tags: [], due: null, estimateMinutes: null, recurrence: null, reminders: [] })
      repo.putTask(task)
      expect(repo.getTask('t1')).toEqual(task)
    })

    it('stores all-day due dates and after-completion repeats', () => {
      const repo = makeRepo()
      const task = sampleTask({ due: { date: '2026-12-25', time: null }, recurrence: { kind: 'afterCompletion', every: 3, unit: 'week' } })
      repo.putTask(task)
      expect(repo.getTask('t1')).toEqual(task)
    })

    it('replaces a task with the same id', () => {
      const repo = makeRepo()
      repo.putTask(sampleTask())
      repo.putTask(sampleTask({ title: 'Changed', tags: ['x'] }))
      expect(repo.allTasks()).toHaveLength(1)
      expect(repo.getTask('t1')).toMatchObject({ title: 'Changed', tags: ['x'] })
    })

    it('returns null for a missing task and ignores deletes of missing ids', () => {
      const repo = makeRepo()
      expect(repo.getTask('nope')).toBeNull()
      expect(() => repo.deleteTasks(['nope'])).not.toThrow()
    })

    it('deletes several tasks at once', () => {
      const repo = makeRepo()
      repo.putTask(sampleTask({ id: 'a' }))
      repo.putTask(sampleTask({ id: 'b', parentId: 'a' }))
      repo.putTask(sampleTask({ id: 'c' }))
      repo.deleteTasks(['b', 'a'])
      expect(repo.allTasks().map((t) => t.id)).toEqual(['c'])
    })

    it('hands out copies, so mutating a returned task changes nothing stored', () => {
      const repo = makeRepo()
      repo.putTask(sampleTask())
      const t = repo.getTask('t1')!
      t.title = 'mutated'
      t.tags.push('mutated')
      expect(repo.getTask('t1')).toMatchObject({ title: sampleTask().title, tags: ['health', 'phone'] })
    })

    it('stores, replaces and deletes projects', () => {
      const repo = makeRepo()
      repo.putProject(sampleProject())
      repo.putProject(sampleProject({ id: 'p2', name: 'Work', order: 2 }))
      repo.putProject(sampleProject({ name: 'Home & garden' }))
      expect(repo.getProject('p1')?.name).toBe('Home & garden')
      repo.deleteProject('p2')
      expect(repo.allProjects().map((p) => p.id)).toEqual(['p1'])
      expect(repo.getProject('p2')).toBeNull()
    })

    it('rolls back every change in a transaction that throws', () => {
      const repo = makeRepo()
      repo.putTask(sampleTask({ id: 'keep' }))
      expect(() =>
        repo.transaction(() => {
          repo.putTask(sampleTask({ id: 'new' }))
          repo.putTask(sampleTask({ id: 'keep', title: 'edited' }))
          repo.putProject(sampleProject({ id: 'p9' }))
          repo.deleteTasks(['keep'])
          throw new Error('boom')
        }),
      ).toThrow('boom')
      expect(repo.allTasks().map((t) => t.id)).toEqual(['keep'])
      expect(repo.getTask('keep')?.title).toBe(sampleTask().title)
      expect(repo.getProject('p9')).toBeNull()
    })

    it('commits a transaction that succeeds and returns its value', () => {
      const repo = makeRepo()
      const value = repo.transaction(() => {
        repo.putTask(sampleTask())
        return 42
      })
      expect(value).toBe(42)
      expect(repo.getTask('t1')).not.toBeNull()
    })

    it('treats a nested transaction as part of the outer one', () => {
      const repo = makeRepo()
      expect(() =>
        repo.transaction(() => {
          repo.transaction(() => repo.putTask(sampleTask({ id: 'inner' })))
          throw new Error('outer fails')
        }),
      ).toThrow()
      expect(repo.getTask('inner')).toBeNull()
    })
  })
}
