// ===========================================================================
// The plan validator (teaching module, D25)
// ===========================================================================
//
// What it does: checks a proposed day plan, from Claude or anyone else,
// against every hard constraint, and lists each violation it finds.
//
// Why it exists: a language model can propose a good-looking plan that is
// simply impossible, such as a block overlapping a meeting, running past
// 22:00, or finishing after a task's deadline. The app never applies a plan
// this function rejects, so those mistakes can't reach your calendar,
// however the model behaves. The eval uses the same function to *measure*
// how often the model makes them (PLAN.md §5.2), which is why the
// "raw violation rate" is worth knowing even though the user is protected.
//
// The checks, in plain words. A plan is valid when every block:
//   1. belongs to a real candidate task, which appears at most once;
//   2. has a positive length of at least 15 minutes;
//   3. lies inside the planning window (and not before "now");
//   4. doesn't overlap busy time from the calendar;
//   5. doesn't overlap another block (you can't do two tasks at once);
//   6. ends by the task's deadline;
//   7. isn't longer than the task's estimate × 1.25 (a generous margin,
//      but not a whole afternoon for a 15-minute task), and never needs to
//      be shorter than the 15-minute minimum;
// and the plan as a whole:
//   8. lists every candidate either in a block or as "unscheduled", so
//      nothing silently disappears.
//
// It is all interval arithmetic on instants. Two intervals [a1, a2) and
// [b1, b2) overlap exactly when a1 < b2 and b1 < a2, and every overlap check
// below is that one comparison.
// ===========================================================================

import { deadlineOf } from './deadline'
import { mergeIntervals, windowOf } from './slots'
import { DEFAULT_ESTIMATE, ESTIMATE_SLACK, MIN_BLOCK_MINUTES, type Interval, type PlanDay, type PlanProposal, type PlanTask } from './types'

export type ViolationKind =
  | 'unknown-task'
  | 'duplicate-task'
  | 'too-short'
  | 'outside-window'
  | 'before-now'
  | 'overlaps-busy'
  | 'overlaps-block'
  | 'after-deadline'
  | 'over-estimate'
  | 'missing-task'
  | 'malformed'

export interface Violation {
  kind: ViolationKind
  taskId?: string
  detail: string
}

export interface ValidationResult {
  ok: boolean
  violations: Violation[]
}

const t = (iso: string) => Date.parse(iso)

/** The one overlap test: half-open intervals [a.start, a.end) and [b.start, b.end). */
export function overlaps(a: Interval, b: Interval): boolean {
  return t(a.start) < t(b.end) && t(b.start) < t(a.end)
}

export function validatePlan(plan: PlanProposal, tasks: PlanTask[], day: PlanDay): ValidationResult {
  const violations: Violation[] = []
  const add = (kind: ViolationKind, detail: string, taskId?: string) => violations.push({ kind, detail, ...(taskId ? { taskId } : {}) })
  const byId = new Map(tasks.map((x) => [x.id, x]))
  const window = windowOf(day)
  const busy = mergeIntervals(day.busy)
  const seen = new Set<string>()

  for (const block of plan.blocks) {
    const task = byId.get(block.taskId)

    // 1. A real candidate, once.
    if (!task) {
      add('unknown-task', `Block for "${block.taskId}", which isn't one of the candidate tasks.`, block.taskId)
      continue
    }
    if (seen.has(task.id)) add('duplicate-task', `"${task.title}" is scheduled more than once.`, task.id)
    seen.add(task.id)

    // 2. A real interval of a sensible length.
    if (Number.isNaN(t(block.start)) || Number.isNaN(t(block.end)) || t(block.end) <= t(block.start)) {
      add('malformed', `"${task.title}" has an invalid start or end.`, task.id)
      continue
    }
    const minutes = (t(block.end) - t(block.start)) / 60_000
    if (minutes < MIN_BLOCK_MINUTES) add('too-short', `"${task.title}" gets ${minutes} min (minimum ${MIN_BLOCK_MINUTES}).`, task.id)

    // 3. Inside the window, and not in the past.
    if (t(block.start) < t(window.start) || t(block.end) > t(window.end)) add('outside-window', `"${task.title}" falls outside the planning window.`, task.id)
    if (day.notBefore && t(block.start) < t(day.notBefore)) add('before-now', `"${task.title}" starts before now.`, task.id)

    // 4. Not during busy time.
    if (busy.some((b) => overlaps(block, b))) add('overlaps-busy', `"${task.title}" overlaps a calendar event.`, task.id)

    // 6. By the deadline.
    const deadline = deadlineOf(task, day.zone)
    if (deadline && t(block.end) > t(deadline)) add('after-deadline', `"${task.title}" would finish after it's due.`, task.id)

    // 7. Not wildly longer than the estimate.
    // (Never below the 15-minute minimum, or a 10-minute task could satisfy neither rule.)
    const estimate = task.estimateMinutes || DEFAULT_ESTIMATE
    if (minutes > Math.max(estimate * ESTIMATE_SLACK, MIN_BLOCK_MINUTES)) add('over-estimate', `"${task.title}" gets ${minutes} min for a ${estimate}-min estimate.`, task.id)
  }

  // 5. No two blocks at once. Sorting by start means only neighbours need comparing.
  const sorted = plan.blocks.filter((b) => !Number.isNaN(t(b.start)) && !Number.isNaN(t(b.end))).sort((a, b) => t(a.start) - t(b.start))
  for (let i = 1; i < sorted.length; i++) {
    if (overlaps(sorted[i - 1]!, sorted[i]!)) add('overlaps-block', `Two tasks are scheduled at the same time.`, sorted[i]!.taskId)
  }

  // 8. Every candidate accounted for.
  const listed = new Set([...plan.blocks.map((b) => b.taskId), ...plan.unscheduled])
  for (const task of tasks) if (!listed.has(task.id)) add('missing-task', `"${task.title}" is neither scheduled nor listed as unscheduled.`, task.id)

  return { ok: violations.length === 0, violations }
}
