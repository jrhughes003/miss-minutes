// Plan my day (M10): shared shapes.
//
// Times are instants (UTC ISO strings) so arithmetic is exact across DST days;
// the UI shows them in local time.

import type { Priority } from '../tasks/types'
import type { LocalDate, LocalTime } from '../time'

/** A task as the planner sees it. Ids are short and opaque ("t1") when sent to the model. */
export interface PlanTask {
  id: string
  title: string
  /** Minutes. Tasks without an estimate are planned at DEFAULT_ESTIMATE. */
  estimateMinutes: number
  priority: Priority
  /** The last local date it may be done on, or null for no deadline. */
  dueDate: LocalDate | null
  /** A due time on dueDate, if the task has one: the block must end by it. */
  dueTime: LocalTime | null
}

export interface Interval {
  start: string
  end: string
}

export interface PlanBlock extends Interval {
  taskId: string
}

export interface PlanProposal {
  blocks: PlanBlock[]
  /** Candidate tasks deliberately left out (no room, or not worth it today). */
  unscheduled: string[]
}

/** The day being planned. */
export interface PlanDay {
  date: LocalDate
  zone: string
  /** The planning window (D6: 07:00–22:00 by default). */
  window: { start: LocalTime; end: LocalTime }
  /** Busy time from calendars: opaque events only, already cut to this day. */
  busy: Interval[]
  /** Planning starts no earlier than this (now, when planning today). */
  notBefore: string | null
}

export const DEFAULT_ESTIMATE = 30
export const MIN_BLOCK_MINUTES = 15
/** A block may run over its estimate by at most this factor (PLAN.md §5.2). */
export const ESTIMATE_SLACK = 1.25
