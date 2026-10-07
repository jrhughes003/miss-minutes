// Plan-eval metrics (PLAN.md §5.2), computed with the same validator the app
// uses to guard writes.

import { minutesOf } from '../../src/core/plan/slots'
import type { PlanProposal } from '../../src/core/plan/types'
import { validatePlan, type ViolationKind } from '../../src/core/plan/validate'
import type { PlanCase } from './cases'

export interface PlanMetrics {
  days: number
  infeasibleDays: number
  /** Days with at least one hard violation *before* validation. Target for Claude ≤ 5 %. */
  rawViolationRate: number
  violationsByKind: Partial<Record<ViolationKind, number>>
  /** On feasible days: share of tasks due that day that got a block. Target ≥ 95 %. */
  dueTodayScheduled: number
  /** Priority-weighted scheduled minutes, divided by the greedy baseline's. Target ≥ 1.00. */
  weightedMinutesVsGreedy: number
  /** On infeasible days: share of plans that are valid and list unscheduled tasks rather than overpack. Target ≥ 95 %. */
  infeasibleHandled: number
}

const WEIGHT = { 1: 4, 2: 3, 3: 2, 4: 1 } as const

export function weightedMinutes(c: PlanCase, p: PlanProposal): number {
  const byId = new Map(c.tasks.map((t) => [t.id, t]))
  return p.blocks.reduce((s, b) => s + minutesOf(b) * (byId.get(b.taskId) ? WEIGHT[byId.get(b.taskId)!.priority] : 0), 0)
}

export function computePlanMetrics(cases: PlanCase[], plans: Map<string, PlanProposal>, greedy: Map<string, PlanProposal>): PlanMetrics {
  let violating = 0
  const byKind: Partial<Record<ViolationKind, number>> = {}
  let dueToday = 0
  let dueTodayScheduled = 0
  let weighted = 0
  let weightedGreedy = 0
  let infeasible = 0
  let infeasibleOk = 0

  for (const c of cases) {
    const plan = plans.get(c.id)
    if (!plan) throw new Error(`No plan for ${c.id}`)
    const v = validatePlan(plan, c.tasks, c.day)
    if (!v.ok) violating++
    for (const x of v.violations) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1
    // Quality counts only valid plans: an invalid one would be refused by the app.
    const valid = v.ok
    if (!c.infeasible) {
      const due = c.tasks.filter((t) => t.dueDate === c.day.date)
      dueToday += due.length
      if (valid) dueTodayScheduled += due.filter((t) => plan.blocks.some((b) => b.taskId === t.id)).length
    } else {
      infeasible++
      if (valid && plan.unscheduled.length > 0) infeasibleOk++
    }
    if (valid) weighted += weightedMinutes(c, plan)
    weightedGreedy += weightedMinutes(c, greedy.get(c.id)!)
  }
  const share = (n: number, d: number) => (d === 0 ? 1 : n / d)
  return {
    days: cases.length,
    infeasibleDays: infeasible,
    rawViolationRate: share(violating, cases.length),
    violationsByKind: byKind,
    dueTodayScheduled: share(dueTodayScheduled, dueToday),
    weightedMinutesVsGreedy: weightedGreedy === 0 ? 1 : weighted / weightedGreedy,
    infeasibleHandled: share(infeasibleOk, infeasible),
  }
}
