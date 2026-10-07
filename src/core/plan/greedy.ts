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

export function greedyPlan(tasks: PlanTask[], day: PlanDay): PlanProposal {
  const gaps = freeSlots(day).map((g) => ({ start: Date.parse(g.start), end: Date.parse(g.end) }))
  const blocks: PlanProposal['blocks'] = []
  const unscheduled: string[] = []
  for (const t of orderForPlanning(tasks)) {
    const need = Math.max(t.estimateMinutes || DEFAULT_ESTIMATE, MIN_BLOCK_MINUTES) * 60_000
    const deadline = deadlineOf(t, day.zone)
    const limit = deadline ? Date.parse(deadline) : Number.POSITIVE_INFINITY
    const gap = gaps.find((g) => g.end - g.start >= need && g.start + need <= limit)
    if (!gap) {
      unscheduled.push(t.id)
      continue
    }
    blocks.push({ taskId: t.id, start: new Date(gap.start).toISOString(), end: new Date(gap.start + need).toISOString() })
    gap.start += need // the rest of the gap stays available
  }
  return { blocks: blocks.sort((a, b) => a.start.localeCompare(b.start)), unscheduled }
}
