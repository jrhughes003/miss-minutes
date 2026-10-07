import type { Due, Recurrence } from '../recurrence'
import type { ReminderInput, ReminderRule } from '../reminders/types'

/** 1 is most urgent; 4 means "no priority" (D4). */
export type Priority = 1 | 2 | 3 | 4
export type TaskStatus = 'open' | 'done'

export interface Task {
  id: string
  title: string
  notes: string
  /** null = Inbox. */
  projectId: string | null
  /** Lower-case, without '#', unique, sorted. */
  tags: string[]
  priority: Priority
  /** Wall-clock due date and optional time, interpreted in the user's current zone (D6). */
  due: Due | null
  estimateMinutes: number | null
  recurrence: Recurrence | null
  /** At most 5 (Google Calendar's popup limit, so they can reach the phone, D8). */
  reminders: ReminderRule[]
  /** Subtasks point at their parent; one level only (D4). */
  parentId: string | null
  status: TaskStatus
  /** Instants, as UTC ISO strings. */
  completedAt: string | null
  createdAt: string
  updatedAt: string
  /** Manual ordering within a list; lower comes first. */
  order: number
}

export interface Project {
  id: string
  name: string
  color: string
  order: number
  createdAt: string
  updatedAt: string
}

export interface NewTask {
  title: string
  notes?: string
  projectId?: string | null
  tags?: string[]
  priority?: Priority
  due?: Due | null
  estimateMinutes?: number | null
  recurrence?: Recurrence | null
  reminders?: ReminderInput[]
  parentId?: string | null
}

/** Fields that can be edited after creation. Moving a subtask between parents is not supported. */
export type TaskPatch = Partial<Omit<NewTask, 'parentId'> & { order: number }>

export interface TaskQuery {
  /** Default 'open'. */
  status?: TaskStatus | 'all'
  /** A project id, null for Inbox, undefined for every project. */
  projectId?: string | null
  tag?: string
  /** Case-insensitive text match on title and notes. */
  search?: string
  /** Include subtasks in the result (default false: top-level tasks only). */
  includeSubtasks?: boolean
}

/**
 * Storage port: the minimum the service needs from a store. Both
 * implementations (SQLite in the main process, localStorage in the browser)
 * are synchronous, which keeps the service simple and lets one shared test
 * suite check both (src/test/repoContract.ts).
 */
export interface TaskRepo {
  /** Run `fn` atomically: if it throws, no change made inside it persists. */
  transaction<T>(fn: () => T): T
  getTask(id: string): Task | null
  allTasks(): Task[]
  /** Insert or replace by id. */
  putTask(task: Task): void
  deleteTasks(ids: string[]): void
  getProject(id: string): Project | null
  allProjects(): Project[]
  putProject(project: Project): void
  deleteProject(id: string): void
}
