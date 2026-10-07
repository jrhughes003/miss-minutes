import { describe, expect, it } from 'vitest'
import { greedyPlan } from '../../src/core/plan/greedy'
import { validatePlan } from '../../src/core/plan/validate'
import { PLAN_CASES } from './cases'
import { computePlanMetrics } from './metrics'

describe('the frozen plan case set', () => {
  it('has 200 days with unique ids, both DST days, and about 15 % overloaded', () => {
    expect(PLAN_CASES).toHaveLength(200)
    expect(new Set(PLAN_CASES.map((c) => c.id)).size).toBe(200)
    expect(PLAN_CASES.some((c) => c.day.date === '2026-03-08')).toBe(true)
    expect(PLAN_CASES.some((c) => c.day.date === '2026-11-01')).toBe(true)
    const overloaded = PLAN_CASES.filter((c) => c.infeasible).length / PLAN_CASES.length
    expect(overloaded).toBeGreaterThan(0.1)
    expect(overloaded).toBeLessThan(0.25)
  })

  it('the greedy baseline never violates a hard constraint on any day', () => {
    for (const c of PLAN_CASES) expect(validatePlan(greedyPlan(c.tasks, c.day), c.tasks, c.day).violations, c.id).toEqual([])
  })

  it('metrics count an invalid plan as a violation and give it no quality credit', () => {
    const greedy = new Map(PLAN_CASES.map((c) => [c.id, greedyPlan(c.tasks, c.day)]))
    const broken = new Map(greedy)
    const first = PLAN_CASES[0]!
    broken.set(first.id, { blocks: [], unscheduled: [] }) // drops every task: "missing-task"
    const m = computePlanMetrics(PLAN_CASES, broken, greedy)
    expect(m.rawViolationRate).toBeCloseTo(1 / 200)
    expect(m.weightedMinutesVsGreedy).toBeLessThan(1)
  })
})
