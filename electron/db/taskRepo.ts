// TaskRepo over SQLite, for the desktop app. It maps rows to Task objects and
// back; all business rules live in the shared TaskService.

import type { Recurrence } from '../../src/core/recurrence'
import type { ReminderRule } from '../../src/core/reminders/types'
import type { Priority, Project, Task, TaskRepo, TaskStatus } from '../../src/core/tasks/types'
import type { SqlDatabase, SqlRow } from './database'

export class SqliteTaskRepo implements TaskRepo {
  private depth = 0
  private readonly stmt

  constructor(private readonly db: SqlDatabase) {
    // Prepared once and reused: faster, and the SQL is checked at startup
    // rather than on first use.
    this.stmt = {
      getTask: db.prepare('SELECT * FROM tasks WHERE id = @id'),
      allTasks: db.prepare('SELECT * FROM tasks'),
      tagsFor: db.prepare('SELECT tag FROM task_tags WHERE task_id = @id ORDER BY tag'),
      allTags: db.prepare('SELECT task_id, tag FROM task_tags ORDER BY tag'),
      upsertTask: db.prepare(`
        INSERT INTO tasks (id, title, notes, project_id, priority, due_date, due_time, estimate_minutes,
                           recurrence, reminders, parent_id, status, completed_at, created_at, updated_at, sort_order)
        VALUES (@id, @title, @notes, @project_id, @priority, @due_date, @due_time, @estimate_minutes,
                @recurrence, @reminders, @parent_id, @status, @completed_at, @created_at, @updated_at, @sort_order)
        ON CONFLICT (id) DO UPDATE SET
          title = excluded.title, notes = excluded.notes, project_id = excluded.project_id,
          priority = excluded.priority, due_date = excluded.due_date, due_time = excluded.due_time,
          estimate_minutes = excluded.estimate_minutes, recurrence = excluded.recurrence, reminders = excluded.reminders,
          parent_id = excluded.parent_id, status = excluded.status, completed_at = excluded.completed_at,
          created_at = excluded.created_at, updated_at = excluded.updated_at, sort_order = excluded.sort_order`),
      clearTags: db.prepare('DELETE FROM task_tags WHERE task_id = @id'),
      addTag: db.prepare('INSERT INTO task_tags (task_id, tag) VALUES (@id, @tag)'),
      deleteTask: db.prepare('DELETE FROM tasks WHERE id = @id'),
      getProject: db.prepare('SELECT * FROM projects WHERE id = @id'),
      allProjects: db.prepare('SELECT * FROM projects'),
      upsertProject: db.prepare(`
        INSERT INTO projects (id, name, color, sort_order, created_at, updated_at)
        VALUES (@id, @name, @color, @sort_order, @created_at, @updated_at)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color,
          sort_order = excluded.sort_order, created_at = excluded.created_at, updated_at = excluded.updated_at`),
      deleteProject: db.prepare('DELETE FROM projects WHERE id = @id'),
    }
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn() // nested: part of the outer transaction
    this.db.exec('BEGIN IMMEDIATE')
    this.depth++
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    } finally {
      this.depth--
    }
  }

  getTask(id: string): Task | null {
    const row = this.stmt.getTask.get({ id })
    if (!row) return null
    const tags = this.stmt.tagsFor.all({ id }).map((r) => String(r.tag))
    return rowToTask(row, tags)
  }

  allTasks(): Task[] {
    // Two queries rather than one per task: tags for every task in one pass.
    const tagsByTask = new Map<string, string[]>()
    for (const r of this.stmt.allTags.all()) {
      const id = String(r.task_id)
      const list = tagsByTask.get(id) ?? []
      list.push(String(r.tag))
      tagsByTask.set(id, list)
    }
    return this.stmt.allTasks.all().map((row) => rowToTask(row, tagsByTask.get(String(row.id)) ?? []))
  }

  putTask(task: Task): void {
    this.transaction(() => {
      this.stmt.upsertTask.run({
        id: task.id,
        title: task.title,
        notes: task.notes,
        project_id: task.projectId,
        priority: task.priority,
        due_date: task.due?.date ?? null,
        due_time: task.due?.time ?? null,
        estimate_minutes: task.estimateMinutes,
        recurrence: task.recurrence ? JSON.stringify(task.recurrence) : null,
        reminders: JSON.stringify(task.reminders),
        parent_id: task.parentId,
        status: task.status,
        completed_at: task.completedAt,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
        sort_order: task.order,
      })
      this.stmt.clearTags.run({ id: task.id })
      for (const tag of task.tags) this.stmt.addTag.run({ id: task.id, tag })
    })
  }

  deleteTasks(ids: string[]): void {
    this.transaction(() => {
      for (const id of ids) this.stmt.deleteTask.run({ id })
    })
  }

  getProject(id: string): Project | null {
    const row = this.stmt.getProject.get({ id })
    return row ? rowToProject(row) : null
  }

  allProjects(): Project[] {
    return this.stmt.allProjects.all().map(rowToProject)
  }

  putProject(project: Project): void {
    this.stmt.upsertProject.run({
      id: project.id,
      name: project.name,
      color: project.color,
      sort_order: project.order,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    })
  }

  deleteProject(id: string): void {
    this.stmt.deleteProject.run({ id })
  }
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

function rowToTask(row: SqlRow, tags: string[]): Task {
  const dueDate = str(row.due_date)
  return {
    id: String(row.id),
    title: String(row.title),
    notes: String(row.notes ?? ''),
    projectId: str(row.project_id),
    tags: [...tags].sort(),
    priority: Number(row.priority) as Priority,
    due: dueDate ? { date: dueDate, time: str(row.due_time) } : null,
    estimateMinutes: row.estimate_minutes === null ? null : Number(row.estimate_minutes),
    recurrence: row.recurrence ? (JSON.parse(String(row.recurrence)) as Recurrence) : null,
    reminders: JSON.parse(String(row.reminders ?? '[]')) as ReminderRule[],
    parentId: str(row.parent_id),
    status: String(row.status) as TaskStatus,
    completedAt: str(row.completed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    order: Number(row.sort_order),
  }
}

function rowToProject(row: SqlRow): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    color: String(row.color),
    order: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
