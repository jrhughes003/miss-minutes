// The deterministic planner: plan-my-day's fallback with AI off, and the
// baseline the plan eval compares Claude against (PLAN.md §5.2).
//
// Earliest deadline first, then priority. Each task goes, whole, into the
// earliest free gap with room for it. Tasks aren't split, and anything that
// doesn't fit is listed as unscheduled. Its plans can't violate a hard
// constraint (the validator would say so), so the eval measures what an AI
// plan adds in *quality*, not in safety.

import { deadlineOf } from './deadline'
import { freeSlots } from './slots'
import { DEFAULT_ESTIMATE, MIN_BLOCK_MINUTES, type PlanDay, type PlanProposal, type PlanTask } from './types'

const deadlineKey = (t: PlanTask) => `${t.dueDate ?? '9999-12-31'}T${t.dueTime ?? '24:00'}`

export function orderForPlanning(tasks: PlanTask[]): PlanTask[] {
  return [...tasks].sort((a, b) => deadlineKey(a).localeCompare(deadlineKey(b)) || a.priority - b.priority || b.estimateMinutes - a.estimateMinutes || a.id.localeCompare(b.id))
}

export interface GreedyOptions {
  /** A break after each block and around calendar events. */
  bufferMinutes?: number
  /** Start blocks only on this grid (e.g. 15 for :00/:15/:30/:45). */
  snapMinutes?: number
}

/**
 * Plans the day. The options make a planned day nicer to live with (room to
 * breathe, tidy start times); the eval baseline uses neither.
 */
export function greedyPlan(tasks: PlanTask[], day: PlanDay, { bufferMinutes = 0, snapMinutes = 0 }: GreedyOptions = {}): PlanProposal {
  const buf = bufferMinutes * 60_000
  const grid = snapMinutes * 60_000
  // Instants are UTC ms; every real zone offset is a whole number of 15 minutes, so this is a local grid too.
  const startIn = (g: { start: number }) => (grid ? Math.ceil(g.start / grid) * grid : g.start)
  const padded = buf ? day.busy.map((b) => ({ start: new Date(Date.parse(b.start) - buf).toISOString(), end: new Date(Date.parse(b.end) + buf).toISOString() })) : day.busy
  const gaps = freeSlots({ ...day, busy: padded }).map((g) => ({ start: Date.parse(g.start), end: Date.parse(g.end) }))
  const blocks: PlanProposal['blocks'] = []
  const unscheduled: string[] = []
  for (const t of orderForPlanning(tasks)) {
    const need = Math.max(t.estimateMinutes || DEFAULT_ESTIMATE, MIN_BLOCK_MINUTES) * 60_000
    const deadline = deadlineOf(t, day.zone)
    const limit = deadline ? Date.parse(deadline) : Number.POSITIVE_INFINITY
    const gap = gaps.find((g) => g.end - startIn(g) >= need && startIn(g) + need <= limit)
    if (!gap) {
      unscheduled.push(t.id)
      continue
    }
    const start = startIn(gap)
    blocks.push({ taskId: t.id, start: new Date(start).toISOString(), end: new Date(start + need).toISOString() })
    gap.start = start + need + buf // the rest of the gap stays available, after a break
  }
  return { blocks: blocks.sort((a, b) => a.start.localeCompare(b.start)), unscheduled }
}
