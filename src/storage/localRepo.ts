// TaskRepo over browser localStorage, used by the web demo and `npm run dev`.
//
// The whole dataset is one JSON document under one key. That's fine at
// personal scale (thousands of tasks is well under localStorage's ~5 MB) and
// makes transactions easy: snapshot before, restore on error, write once at
// the end.

import type { Project, Task, TaskRepo } from '../core/tasks/types'

/** The part of the Storage API we use, so tests can pass an in-memory map. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface Snapshot {
  version: 1
  tasks: Record<string, Task>
  projects: Record<string, Project>
}

export const LOCAL_STORAGE_KEY = 'miss-minutes:data:v1'

const empty = (): Snapshot => ({ version: 1, tasks: {}, projects: {} })

export class LocalTaskRepo implements TaskRepo {
  private state: Snapshot
  private depth = 0

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key = LOCAL_STORAGE_KEY,
  ) {
    this.state = this.load()
  }

  private load(): Snapshot {
    const raw = this.storage.getItem(this.key)
    if (!raw) return empty()
    try {
      const parsed = JSON.parse(raw) as Partial<Snapshot>
      if (parsed.version !== 1) throw new Error(`unknown version ${String(parsed.version)}`)
      const tasks = parsed.tasks ?? {}
      // Data saved before reminders existed (M1) has no `reminders` field.
      for (const t of Object.values(tasks)) t.reminders ??= []
      return { version: 1, tasks, projects: parsed.projects ?? {} }
    } catch (e) {
      // Never silently replace data we couldn't read: keep a copy beside it first.
      this.storage.setItem(`${this.key}:unreadable:${raw.length}`, raw)
      console.error('Miss Minutes: stored data was unreadable and has been set aside.', e)
      return empty()
    }
  }

  private save(): void {
    this.storage.setItem(this.key, JSON.stringify(this.state))
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn() // nested: the outermost transaction commits or rolls back
    const before = structuredClone(this.state)
    this.depth++
    try {
      const result = fn()
      this.save() // throws if the browser's storage quota is full, which rolls back below
      return result
    } catch (e) {
      this.state = before
      throw e
    } finally {
      this.depth--
    }
  }

  private write(mutate: () => void): void {
    mutate()
    if (this.depth === 0) this.save()
  }

  getTask(id: string): Task | null {
    const t = this.state.tasks[id]
    return t ? structuredClone(t) : null
  }

  allTasks(): Task[] {
    return Object.values(this.state.tasks).map((t) => structuredClone(t))
  }

  putTask(task: Task): void {
    this.write(() => {
      this.state.tasks[task.id] = structuredClone(task)
    })
  }

  deleteTasks(ids: string[]): void {
    this.write(() => {
      for (const id of ids) delete this.state.tasks[id]
    })
  }

  getProject(id: string): Project | null {
    const p = this.state.projects[id]
    return p ? structuredClone(p) : null
  }

  allProjects(): Project[] {
    return Object.values(this.state.projects).map((p) => structuredClone(p))
  }

  putProject(project: Project): void {
    this.write(() => {
      this.state.projects[project.id] = structuredClone(project)
    })
  }

  deleteProject(id: string): void {
    this.write(() => {
      delete this.state.projects[id]
    })
  }
}

/** An in-memory KeyValueStorage, for tests. */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}
