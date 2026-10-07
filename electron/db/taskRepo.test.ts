import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../src/core/clock'
import { TaskService } from '../../src/core/tasks/service'
import { sampleTask, taskRepoContract } from '../../src/test/repoContract'
import { openDatabase } from './database'
import { migrate } from './migrations'
import { SqliteTaskRepo } from './taskRepo'

function freshRepo() {
  const db = openDatabase(':memory:')
  migrate(db)
  return { db, repo: new SqliteTaskRepo(db) }
}

taskRepoContract('SQLite', () => freshRepo().repo)

describe('SqliteTaskRepo specifics', () => {
  it('enforces the schema’s checks as a last line of defence', () => {
    const { repo } = freshRepo()
    expect(() => repo.putTask(sampleTask({ priority: 9 as never }))).toThrow(/CHECK/)
    expect(() => repo.putTask(sampleTask({ title: '' }))).toThrow(/CHECK/)
  })

  it('rejects a task pointing at a project that does not exist (foreign keys are on)', () => {
    const { repo } = freshRepo()
    expect(() => repo.putTask(sampleTask({ projectId: 'ghost' }))).toThrow(/FOREIGN KEY/)
  })

  it('cascades subtask deletion in the database too', () => {
    const { repo } = freshRepo()
    repo.putTask(sampleTask({ id: 'p' }))
    repo.putTask(sampleTask({ id: 'c', parentId: 'p' }))
    repo.deleteTasks(['p'])
    expect(repo.allTasks()).toEqual([])
  })

  it('runs the full service end to end', () => {
    const { repo } = freshRepo()
    let n = 0
    const svc = new TaskService(repo, new FakeClock('2026-10-06T14:00:00Z'), () => `id${++n}`)
    const p = svc.createProject('Home')
    const t = svc.createTask({ title: 'Bins out', projectId: p.id, tags: ['chores'], due: { date: '2026-10-06', time: '19:00' }, recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY' } })
    svc.createTask({ title: 'Recycling too', parentId: t.id })
    const { next } = svc.completeTask(t.id)
    expect(next?.due).toEqual({ date: '2026-10-13', time: '19:00' })
    expect(svc.subtasksOf(next!.id).map((s) => s.title)).toEqual(['Recycling too'])
    expect(svc.listTasks({ tag: 'chores' }).map((x) => x.id)).toEqual([next!.id])
    svc.deleteProject(p.id)
    expect(svc.getTask(next!.id)?.projectId).toBeNull()
  })
})
