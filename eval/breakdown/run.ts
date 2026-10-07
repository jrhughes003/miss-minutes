// Runs the breakdown eval.   npm run eval:breakdown -- --accept-cost   (needs ANTHROPIC_API_KEY)
// Writes the shape-check results, and a rating sheet for the 20 hand-rated cases.
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { checkSteps } from '../../src/core/breakdown/checks'
import { breakdownWithClaude, BREAKDOWN_MODEL, estimateBreakdownCostUsd } from '../../electron/ai/breakdown'
import { BREAKDOWN_CASES } from './cases'

async function main() {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('Set ANTHROPIC_API_KEY.')
  console.log(`Estimated cost for ${BREAKDOWN_CASES.length} tasks on ${BREAKDOWN_MODEL}: about $${estimateBreakdownCostUsd(BREAKDOWN_CASES.length).toFixed(2)}.`)
  if (!process.argv.includes('--accept-cost')) throw new Error('Re-run with --accept-cost to confirm.')
  // A run against a local server (the mock) is labelled as such, never as real results.
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(process.env.ANTHROPIC_BASE_URL ?? '')
  const label = local ? 'mock' : 'claude'
  const client = new Anthropic({ apiKey: key, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}) })

  const rows: string[] = []
  const sheet: string[] = []
  let passed = 0
  let cost = 0
  for (const c of BREAKDOWN_CASES) {
    const { raw, usage } = await breakdownWithClaude(client, { title: c.title, ...(c.notes ? { notes: c.notes } : {}), projectName: c.projectName ?? null, due: c.due ?? null })
    cost += usage.costUsd
    // Scored on the raw (tidied) output, before the app's filter drops bad steps.
    const check = checkSteps(raw, `${c.title} ${c.notes ?? ''} ${c.due ?? ''}`)
    if (check.ok) passed++
    const issues = [...check.problems, ...check.perStep.flatMap((p, i) => p.problems.map((x) => `step ${i + 1}: ${x}`))]
    rows.push(`| ${c.id} | ${c.title} | ${check.ok ? 'pass' : `fail: ${issues.join('; ')}`} |`)
    if (c.rate) sheet.push(`### ${c.id}: ${c.title}\n\n${raw.map((s) => `- ${s}`).join('\n')}\n\nRating (1 = not useful, 2 = partly, 3 = would use as is): ___\n`)
  }

  const date = new Date().toISOString().slice(0, 10)
  const dir = path.resolve('eval', 'results')
  fs.mkdirSync(dir, { recursive: true })
  const model = local ? `${BREAKDOWN_MODEL} via local mock server (NOT a real model)` : BREAKDOWN_MODEL
  fs.writeFileSync(
    path.join(dir, `breakdown-${label}-${date}.md`),
    `# Breakdown eval: ${label} (${model})\n\n- Date: ${date}\n- Shape checks passed: **${passed} / ${BREAKDOWN_CASES.length}** (target 100 %)\n- Cost: $${cost.toFixed(4)}\n\n| Case | Task | Shape checks |\n|---|---|---|\n${rows.join('\n')}\n`,
  )
  fs.writeFileSync(path.join(dir, `breakdown-${label}-${date}-rating-sheet.md`), `# Rate these by hand (PLAN.md §5.4: target mean ≥ 2.3)\n\n${sheet.join('\n')}`)
  console.log(`Shape checks passed ${passed}/${BREAKDOWN_CASES.length}. Wrote eval/results/breakdown-${label}-${date}.md and the rating sheet.`)
}

main().catch((e: unknown) => {
  console.error((e as Error).message)
  process.exit(1)
})
