// Runs the plan eval.   npm run eval:plan -- --system greedy
// The Claude system is added with the plan prompt (M10 wiring); it will need
// ANTHROPIC_API_KEY and --accept-cost, like the other evals.
import fs from 'node:fs'
import path from 'node:path'
import { greedyPlan } from '../../src/core/plan/greedy'
import type { PlanProposal } from '../../src/core/plan/types'
import { PLAN_CASES } from './cases'
import { computePlanMetrics } from './metrics'

const pct = (x: number) => `${(x * 100).toFixed(1)} %`

function main() {
  const i = process.argv.indexOf('--system')
  const system = i >= 0 ? process.argv[i + 1] : 'greedy'
  if (system !== 'greedy') throw new Error('Only the greedy baseline exists so far; the Claude planner arrives with the M10 wiring.')

  const greedy = new Map<string, PlanProposal>(PLAN_CASES.map((c) => [c.id, greedyPlan(c.tasks, c.day)]))
  const m = computePlanMetrics(PLAN_CASES, greedy, greedy)
  const date = new Date().toISOString().slice(0, 10)
  const md = `# Plan eval: greedy baseline\n\n- Date: ${date}\n- Days: ${m.days} (${m.infeasibleDays} overloaded)\n\n| Metric | Greedy | Target (Claude) |\n|---|---|---|\n| Raw violation rate (days) | ${pct(m.rawViolationRate)} | ≤ 5 % |\n| Due-today tasks scheduled (feasible days) | ${pct(m.dueTodayScheduled)} | ≥ 95 % |\n| Priority-weighted minutes vs greedy | ${m.weightedMinutesVsGreedy.toFixed(2)} | ≥ 1.00 |\n| Overloaded days handled (valid, lists what didn't fit) | ${pct(m.infeasibleHandled)} | ≥ 95 % |\n\nViolations by kind: ${JSON.stringify(m.violationsByKind)}\n`
  const dir = path.resolve('eval', 'results')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `plan-greedy-${date}.md`), md)
  console.log(md)
}

main()
