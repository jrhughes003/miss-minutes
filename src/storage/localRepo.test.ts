import { describe, expect, it, vi } from 'vitest'
import { sampleTask, taskRepoContract } from '../test/repoContract'
import { LOCAL_STORAGE_KEY, LocalTaskRepo, memoryStorage } from './localRepo'

taskRepoContract('localStorage', () => new LocalTaskRepo(memoryStorage()))

describe('LocalTaskRepo specifics', () => {
  it('persists across instances (a page reload)', () => {
    const storage = memoryStorage()
    new LocalTaskRepo(storage).putTask(sampleTask())
    expect(new LocalTaskRepo(storage).getTask('t1')).toEqual(sampleTask())
  })

  it('writes once per transaction, not once per change', () => {
    const storage = memoryStorage()
    const spy = vi.spyOn(storage, 'setItem')
    const repo = new LocalTaskRepo(storage)
    repo.transaction(() => {
      repo.putTask(sampleTask({ id: 'a' }))
      repo.putTask(sampleTask({ id: 'b' }))
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('rolls back in memory when the browser refuses the write (quota full)', () => {
    const storage = memoryStorage()
    const repo = new LocalTaskRepo(storage)
    repo.putTask(sampleTask({ id: 'before' }))
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => repo.transaction(() => repo.putTask(sampleTask({ id: 'after' })))).toThrow()
    expect(repo.getTask('after')).toBeNull()
    expect(repo.getTask('before')).not.toBeNull()
  })

  it('sets unreadable data aside instead of overwriting it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = memoryStorage({ [LOCAL_STORAGE_KEY]: '{not json' })
    const repo = new LocalTaskRepo(storage)
    expect(repo.allTasks()).toEqual([])
    const kept = [...storage.data.entries()].find(([k]) => k.includes(':unreadable:'))
    expect(kept?.[1]).toBe('{not json')
  })
})
