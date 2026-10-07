// Turning a confirmed day plan into tasks (and, optionally, calendar blocks),
// and taking it back again.
//
// Nothing here runs until the user confirms the plan (PLAN.md §4: the AI or
// the auto-arranger only proposes). Before writing anything, the plan is
// validated again against the calendar as it is *now*, so a meeting added
// since the board was drawn can't be double-booked.
//
// Every apply is recorded as a batch, so "Undo" can reverse exactly that
// apply: tasks it created are deleted, tasks it changed get their old
// due date, estimate and reminders back, and calendar blocks it wrote are
// removed.

import type { Due } from '../recurrence'
import type { ReminderInput, ReminderRule } from '../reminders/types'
import type { TaskService } from '../tasks/service'
import type { Priority } from '../tasks/types'
import { toLocalDateTime, type LocalDate } from '../time'
import { MIN_BLOCK_MINUTES, type Interval, type PlanDay } from './types'
import { validatePlan } from './validate'

export interface PlanApplyItem {
  key: string
  /** An existing task to schedule, or null to create a new one. */
  taskId: string | null
  title: string
  minutes: number
  start: string
  priority: Priority
  tags: string[]
}

export interface PlanApplyRequest {
  date: LocalDate
  items: PlanApplyItem[]
  /** Minutes before each block to remind (D: 5 by default), or null for none. */
  reminderMinutesBefore: number | null
  /** The calendar to write blocks to, or null for tasks only. */
  calendarId: string | null
  /** The day's planning window as the user set it (default 07:00–22:00). */
  window?: { start: string; end: string }
}

export interface BlockRef {
  calendarId: string
  eventId: string
}

export interface PlanBatch {
  id: string
  at: string
  date: LocalDate
  created: string[]
  updated: { taskId: string; due: Due | null; estimateMinutes: number | null; reminders: ReminderRule[] }[]
  blocks: BlockRef[]
  undone: boolean
}

export interface PlanApplyResult {
  batchId: string
  tasksCreated: number
  tasksUpdated: number
  blocksCreated: number
}

/** Writes calendar blocks (desktop with Google). Absent in the web build. */
export interface BlockWriter {
  /** Where a block will be written. Deterministic, so the batch can record it before the write. */
  refFor(calendarId: string, batchId: string, key: string): BlockRef
  /** Writes the blocks; writing one that already exists is not an error. */
  write(calendarId: string, batchId: string, blocks: { key: string; taskId: string; title: string; start: string; end: string }[]): Promise<void>
  /** Removes blocks; removing one that isn't there is not an error. */
  remove(blocks: BlockRef[]): Promise<void>
}

export interface BatchStore {
  save(b: PlanBatch): void
  get(id: string): PlanBatch | null
  latest(): PlanBatch | null
}

export class PlanApplyError extends Error {}

/** What the UI shows about the last apply, with the Undo button. */
export interface PlanBatchSummary {
  id: string
  at: string
  date: LocalDate
  created: number
  updated: number
  blocks: number
  undone: boolean
}

export function summarize(b: PlanBatch): PlanBatchSummary {
  return { id: b.id, at: b.at, date: b.date, created: b.created.length, updated: b.updated.length, blocks: b.blocks.length, undone: b.undone }
}

export async function applyPlan(
  req: PlanApplyRequest,
  o: { tasks: TaskService; batches: BatchStore; writer?: BlockWriter | undefined; day: PlanDay; newId: () => string; now: string },
): Promise<PlanApplyResult> {
  if (req.items.length === 0) throw new PlanApplyError('Nothing to plan.')
  if (req.calendarId && !o.writer) throw new PlanApplyError('Calendar blocks need Google Calendar (desktop app).')

  // Re-check against the calendar as it is now.
  const proposal = { blocks: req.items.map((i) => ({ taskId: i.key, start: i.start, end: new Date(Date.parse(i.start) + i.minutes * 60_000).toISOString() })), unscheduled: [] }
  const tasksForCheck = req.items.map((i) => ({ id: i.key, title: i.title, estimateMinutes: i.minutes, priority: i.priority, dueDate: null, dueTime: null }))
  const check = validatePlan(proposal, tasksForCheck, o.day)
  if (!check.ok) throw new PlanApplyError(`The plan no longer fits: ${check.violations[0]!.detail}`)

  // Every task to reschedule must still exist; checked before anything is written.
  for (const item of req.items) {
    if (item.taskId && !o.tasks.getTask(item.taskId)) throw new PlanApplyError(`"${item.title}" no longer exists.`)
  }

  const batch: PlanBatch = { id: o.newId(), at: o.now, date: req.date, created: [], updated: [], blocks: [], undone: false }
  const reminders: ReminderInput[] = req.reminderMinutesBefore === null ? [] : [{ when: { kind: 'beforeDue', minutes: req.reminderMinutesBefore } }]
  const placed: { key: string; taskId: string; title: string; start: string; end: string }[] = []

  for (const item of req.items) {
    const local = toLocalDateTime(new Date(item.start), o.day.zone)
    const due = { date: local.slice(0, 10), time: local.slice(11) }
    const minutes = Math.max(item.minutes, MIN_BLOCK_MINUTES)
    if (item.taskId) {
      const before = o.tasks.getTask(item.taskId)!
      batch.updated.push({ taskId: before.id, due: before.due, estimateMinutes: before.estimateMinutes, reminders: before.reminders })
      // Keep the task's own reminders, and add the plan's if it doesn't already have one like it.
      const kept: ReminderInput[] = before.reminders.map((r) => ({ id: r.id, when: r.when, phone: r.phone }))
      const extra = reminders.filter((n) => !kept.some((k) => JSON.stringify(k.when) === JSON.stringify(n.when)))
      o.tasks.updateTask(before.id, { due, estimateMinutes: minutes, reminders: [...kept, ...extra].slice(0, 5) })
      placed.push({ key: item.key, taskId: before.id, title: before.title, start: item.start, end: proposal.blocks.find((b) => b.taskId === item.key)!.end })
    } else {
      const created = o.tasks.createTask({ title: item.title, due, estimateMinutes: minutes, priority: item.priority, tags: item.tags, reminders })
      batch.created.push(created.id)
      placed.push({ key: item.key, taskId: created.id, title: created.title, start: item.start, end: proposal.blocks.find((b) => b.taskId === item.key)!.end })
    }
  }
  // Recorded, blocks included, before any block is written: if the write
  // fails halfway, Undo still knows every block that might exist.
  const writer = req.calendarId ? o.writer : undefined
  if (writer) batch.blocks = placed.map((p) => writer.refFor(req.calendarId!, batch.id, p.key))
  o.batches.save(batch)
  if (writer) await writer.write(req.calendarId!, batch.id, placed)
  return { batchId: batch.id, tasksCreated: batch.created.length, tasksUpdated: batch.updated.length, blocksCreated: batch.blocks.length }
}

export async function undoPlan(batchId: string, o: { tasks: TaskService; batches: BatchStore; writer?: BlockWriter | undefined }): Promise<void> {
  const batch = o.batches.get(batchId)
  if (!batch) throw new PlanApplyError('That plan can no longer be undone.')
  if (batch.undone) return // idempotent
  if (batch.blocks.length && o.writer) await o.writer.remove(batch.blocks)
  for (const id of batch.created) o.tasks.deleteTask(id)
  for (const u of batch.updated) {
    if (!o.tasks.getTask(u.taskId)) continue
    o.tasks.updateTask(u.taskId, {
      due: u.due,
      estimateMinutes: u.estimateMinutes,
      reminders: u.reminders.map((r) => ({ id: r.id, when: r.when, phone: r.phone })),
    })
  }
  o.batches.save({ ...batch, undone: true })
}

/** Busy time for planning: timed, non-transparent events on that day. All-day events don't block hours. */
export function busyFromEvents(events: { allDay: boolean; start: string; end: string; transparent?: boolean }[]): Interval[] {
  return events.filter((e) => !e.allDay && !e.transparent).map((e) => ({ start: e.start, end: e.end }))
}
