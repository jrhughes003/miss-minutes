// Task business rules, independent of storage.
//
// The same service runs in two places: in the Electron main process over
// SQLite, and in the browser over localStorage for the web demo. Rules live
// here once, so the demo can't drift from the real app.
//
// Rules decided here (D28, provisional):
// - Subtasks are one level deep, share their parent's project, and can't repeat.
// - Completing a task completes its open subtasks.
// - Completing a repeating task keeps the done copy as history and creates the
//   next occurrence as a new task, copying its subtasks as open. This matches
//   how the task will be mirrored to Google Tasks (D13: only the current
//   occurrence is synced).
// - Deleting a task deletes its subtasks. Deleting a project moves its tasks to
//   the Inbox rather than deleting them.

import type { Clock } from '../clock'
import { nextDue, type Due } from '../recurrence'
import { normalizeReminders } from '../reminders/rules'
import { toLocalDate } from '../time'
import {
  normalizeColor,
  normalizeDue,
  normalizeEstimate,
  normalizeNotes,
  normalizePriority,
  normalizeProjectName,
  normalizeRecurrence,
  normalizeTags,
  normalizeTitle,
  ValidationError,
} from './normalize'
import type { NewTask, Project, Task, TaskPatch, TaskQuery, TaskRepo } from './types'

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} ${id} not found.`)
    this.name = 'NotFoundError'
  }
}

export class TaskService {
  constructor(
    private readonly repo: TaskRepo,
    private readonly clock: Clock,
    private readonly newId: () => string,
  ) {}

  // ---- Reading -------------------------------------------------------------

  getTask(id: string): Task | null {
    return this.repo.getTask(id)
  }

  /** Tasks matching `query`, in display order (see compareTasks). */
  listTasks(query: TaskQuery = {}): Task[] {
    const status = query.status ?? 'open'
    const search = query.search?.trim().toLowerCase()
    const tag = query.tag?.trim().replace(/^#/, '').toLowerCase()
    return this.repo
      .allTasks()
      .filter((t) => status === 'all' || t.status === status)
      .filter((t) => query.includeSubtasks || t.parentId === null)
      .filter((t) => query.projectId === undefined || t.projectId === query.projectId)
      .filter((t) => !tag || t.tags.includes(tag))
      .filter((t) => !search || t.title.toLowerCase().includes(search) || t.notes.toLowerCase().includes(search))
      .sort(compareTasks)
  }

  subtasksOf(parentId: string): Task[] {
    return this.repo
      .allTasks()
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
  }

  listProjects(): Project[] {
    return this.repo.allProjects().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  }

  /** Every tag in use on any task, sorted. */
  listTags(): string[] {
    return [...new Set(this.repo.allTasks().flatMap((t) => t.tags))].sort()
  }

  // ---- Tasks ---------------------------------------------------------------

  createTask(input: NewTask): Task {
    return this.repo.transaction(() => {
      const now = this.clock.now().toISOString()
      const parent = input.parentId ? this.requireTask(input.parentId) : null
      if (parent?.parentId) throw new ValidationError('parentId', 'Subtasks can only be one level deep.')
      const due = normalizeDue(input.due)
      const recurrence = normalizeRecurrence(input.recurrence, due)
      if (parent && recurrence) throw new ValidationError('recurrence', 'A subtask cannot repeat; make the parent repeat instead.')
      const projectId = parent ? parent.projectId : this.checkProject(input.projectId ?? null)

      const task: Task = {
        id: this.newId(),
        title: normalizeTitle(input.title),
        notes: normalizeNotes(input.notes),
        projectId,
        tags: normalizeTags(input.tags),
        priority: normalizePriority(input.priority),
        due,
        estimateMinutes: normalizeEstimate(input.estimateMinutes),
        recurrence,
        reminders: normalizeReminders(input.reminders, due, [], now, this.newId),
        parentId: parent?.id ?? null,
        status: 'open',
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        order: this.nextOrder(parent?.id ?? null),
      }
      this.repo.putTask(task)
      return task
    })
  }

  updateTask(id: string, patch: TaskPatch): Task {
    return this.repo.transaction(() => {
      const task = this.requireTask(id)
      const next: Task = { ...task }
      if (patch.title !== undefined) next.title = normalizeTitle(patch.title)
      if (patch.notes !== undefined) next.notes = normalizeNotes(patch.notes)
      if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags)
      if (patch.priority !== undefined) next.priority = normalizePriority(patch.priority)
      if (patch.due !== undefined) next.due = normalizeDue(patch.due)
      if (patch.estimateMinutes !== undefined) next.estimateMinutes = normalizeEstimate(patch.estimateMinutes)
      if (patch.order !== undefined) {
        if (!Number.isFinite(patch.order)) throw new ValidationError('order', 'Order must be a number.')
        next.order = patch.order
      }
      if (patch.projectId !== undefined) {
        if (task.parentId) throw new ValidationError('projectId', "A subtask always uses its parent's project.")
        next.projectId = this.checkProject(patch.projectId)
      }
      // Recurrence depends on the due date, so it's re-checked whenever either changes.
      const recurrence = patch.recurrence !== undefined ? patch.recurrence : task.recurrence
      next.recurrence = normalizeRecurrence(recurrence, next.due)
      if (task.parentId && next.recurrence) throw new ValidationError('recurrence', 'A subtask cannot repeat.')

      const now = this.clock.now().toISOString()
      if (patch.reminders !== undefined) {
        next.reminders = normalizeReminders(patch.reminders, next.due, task.reminders, now, this.newId)
      } else if (next.reminders.some((r) => r.when.kind === 'beforeDue') && !next.due) {
        throw new ValidationError('reminders', 'Remove the "before due" reminders, or keep a due date.')
      }
      // Moving the due date re-arms its reminders from now, so moving a task
      // into the past doesn't set off a burst of "missed" reminders.
      if (!sameDue(task.due, next.due)) {
        next.reminders = next.reminders.map((r) => (r.when.kind === 'beforeDue' ? { ...r, scheduledAt: now } : r))
      }

      next.updatedAt = now
      this.repo.putTask(next)
      // Subtasks follow their parent's project.
      if (next.projectId !== task.projectId) {
        for (const sub of this.subtasksOf(id)) this.repo.putTask({ ...sub, projectId: next.projectId, updatedAt: next.updatedAt })
      }
      return next
    })
  }

  /**
   * Marks a task done. Returns the completed task and, for a repeating task,
   * the newly created next occurrence (null if the series has ended or the task
   * doesn't repeat). Completing an already-done task changes nothing, so a
   * double click or a retried request is harmless.
   */
  completeTask(id: string): { completed: Task; next: Task | null } {
    return this.repo.transaction(() => {
      const task = this.requireTask(id)
      if (task.status === 'done') return { completed: task, next: null }

      const nowDate = this.clock.now()
      const now = nowDate.toISOString()
      const completed: Task = { ...task, status: 'done', completedAt: now, updatedAt: now }
      this.repo.putTask(completed)

      const subtasks = this.subtasksOf(id)
      for (const sub of subtasks) {
        if (sub.status === 'open') this.repo.putTask({ ...sub, status: 'done', completedAt: now, updatedAt: now })
      }

      let next: Task | null = null
      if (task.recurrence && task.due) {
        const today = toLocalDate(nowDate, this.clock.zone())
        const due = nextDue(task.due, task.recurrence, { today, completedOn: today })
        if (due) {
          next = {
            ...task,
            id: this.newId(),
            due,
            // "Before due" reminders follow the task to its next occurrence;
            // fixed-date reminders belonged to this occurrence only.
            reminders: task.reminders.filter((r) => r.when.kind === 'beforeDue').map((r) => ({ ...r, scheduledAt: now })),
            status: 'open',
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          }
          this.repo.putTask(next)
          for (const sub of subtasks) {
            this.repo.putTask({ ...sub, id: this.newId(), parentId: next.id, status: 'open', completedAt: null, createdAt: now, updatedAt: now, reminders: [] })
          }
        }
      }
      return { completed, next }
    })
  }

  reopenTask(id: string): Task {
    return this.repo.transaction(() => {
      const task = this.requireTask(id)
      if (task.status === 'open') return task
      const reopened: Task = { ...task, status: 'open', completedAt: null, updatedAt: this.clock.now().toISOString() }
      this.repo.putTask(reopened)
      return reopened
    })
  }

  /** Deletes a task and its subtasks. Deleting a missing task is a no-op (idempotent). */
  deleteTask(id: string): void {
    this.repo.transaction(() => {
      const ids = [id, ...this.subtasksOf(id).map((t) => t.id)]
      this.repo.deleteTasks(ids)
    })
  }

  // ---- Projects ------------------------------------------------------------

  createProject(name: string, color?: string): Project {
    return this.repo.transaction(() => {
      const projects = this.repo.allProjects()
      const clean = normalizeProjectName(name)
      if (projects.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
        throw new ValidationError('name', `A project called "${clean}" already exists.`)
      }
      const now = this.clock.now().toISOString()
      const project: Project = {
        id: this.newId(),
        name: clean,
        color: normalizeColor(color, projects.length),
        order: projects.reduce((max, p) => Math.max(max, p.order), 0) + 1,
        createdAt: now,
        updatedAt: now,
      }
      this.repo.putProject(project)
      return project
    })
  }

  renameProject(id: string, name: string): Project {
    return this.repo.transaction(() => {
      const project = this.repo.getProject(id)
      if (!project) throw new NotFoundError('Project', id)
      const clean = normalizeProjectName(name)
      if (this.repo.allProjects().some((p) => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) {
        throw new ValidationError('name', `A project called "${clean}" already exists.`)
      }
      const renamed = { ...project, name: clean, updatedAt: this.clock.now().toISOString() }
      this.repo.putProject(renamed)
      return renamed
    })
  }

  /** Deletes a project; its tasks move to the Inbox. */
  deleteProject(id: string): void {
    this.repo.transaction(() => {
      const now = this.clock.now().toISOString()
      for (const task of this.repo.allTasks()) {
        if (task.projectId === id) this.repo.putTask({ ...task, projectId: null, updatedAt: now })
      }
      this.repo.deleteProject(id)
    })
  }

  // ---- Helpers ---------------------------------------------------------------

  private requireTask(id: string): Task {
    const task = this.repo.getTask(id)
    if (!task) throw new NotFoundError('Task', id)
    return task
  }

  private checkProject(projectId: string | null): string | null {
    if (projectId === null) return null
    if (!this.repo.getProject(projectId)) throw new ValidationError('projectId', 'That project no longer exists.')
    return projectId
  }

  private nextOrder(parentId: string | null): number {
    const siblings = this.repo.allTasks().filter((t) => t.parentId === parentId)
    return siblings.reduce((max, t) => Math.max(max, t.order), 0) + 1
  }
}

function sameDue(a: Due | null, b: Due | null): boolean {
  return a?.date === b?.date && a?.time === b?.time
}

/**
 * Display order: open before done; then by due date (dated before undated),
 * then time (all-day before timed, so the day's all-day items head the list),
 * then priority, then manual order, then age. Done tasks show the most recently
 * completed first.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1
  if (a.status === 'done') return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
  const da = a.due?.date ?? '9999-99-99'
  const db = b.due?.date ?? '9999-99-99'
  if (da !== db) return da < db ? -1 : 1
  const ta = a.due?.time ?? ''
  const tb = b.due?.time ?? ''
  if (ta !== tb) return ta < tb ? -1 : 1
  if (a.priority !== b.priority) return a.priority - b.priority
  if (a.order !== b.order) return a.order - b.order
  return a.createdAt.localeCompare(b.createdAt)
}
