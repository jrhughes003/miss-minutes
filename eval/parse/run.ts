// Runs the parse eval: every case through one parser, graded, summarized and
// saved to eval/results/.
//
//   npm run eval:parse -- --system baseline --split dev
//   npm run eval:parse -- --system claude --split dev --accept-cost   (needs ANTHROPIC_API_KEY)
//
// Claude runs cost money, so they refuse to start without --accept-cost, and
// print an estimate first. Prompt work may use the dev split freely; the test
// split is run once per release candidate (PLAN.md §5.1).

import fs from 'node:fs'
import path from 'node:path'
import { parseBaseline } from '../../src/core/capture/baseline'
import type { CaptureContext, CaptureResult } from '../../src/core/capture/types'
import { casesFor, type ParseCase } from './cases'
import { computeMetrics, gradeCase, TARGETS, type GradeResult, type Metrics } from './grader'

type Parser = (text: string, ctx: CaptureContext) => Promise<{ result: CaptureResult; costUsd?: number }>

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

async function parserFor(system: string, cases: ParseCase[]): Promise<{ parser: Parser; model: string; label: string }> {
  if (system === 'baseline') return { parser: async (t, c) => ({ result: parseBaseline(t, c) }), model: 'chrono-node baseline', label: 'baseline' }
  if (system === 'claude') {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('Set ANTHROPIC_API_KEY to run the Claude system.')
    const { estimateCaptureCostUsd, captureWithClaude, CAPTURE_MODEL } = await import('../../electron/ai/capture')
    const estimate = estimateCaptureCostUsd(cases.length)
    console.log(`Estimated cost for ${cases.length} cases on ${CAPTURE_MODEL}: about $${estimate.toFixed(2)}.`)
    if (!process.argv.includes('--accept-cost')) throw new Error('Re-run with --accept-cost to confirm.')
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: key, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}) })
    // A run against a local server (the mock) is labelled as such, so it can
    // never be mistaken for, or filed as, real Claude results.
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(process.env.ANTHROPIC_BASE_URL ?? '')
    return {
      model: local ? `${CAPTURE_MODEL} via local mock server (NOT a real model)` : CAPTURE_MODEL,
      label: local ? 'mock' : 'claude',
      parser: async (t, c) => {
        const r = await captureWithClaude(client, t, c)
        return { result: r.result, costUsd: r.usage.costUsd }
      },
    }
  }
  throw new Error(`Unknown system "${system}" (use baseline or claude).`)
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`

function report(system: string, model: string, split: string, m: Metrics, latencies: number[], cost: number, grades: GradeResult[], cases: ParseCase[]): string {
  const median = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)] ?? 0
  const target = (k: keyof typeof TARGETS) => `${TARGETS[k].op} ${pct(TARGETS[k].value)}`
  const lines = [
    `# Parse eval: ${system} (${model}), ${split} split`,
    '',
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
    `- Cases: ${m.cases} (${m.unambiguous} unambiguous, ${m.ambiguous} ambiguous)`,
    `- Median latency: ${median.toFixed(0)} ms. Total cost: $${cost.toFixed(4)}`,
    '',
    '| Metric | Result | Target (Claude) |',
    '|---|---|---|',
    `| Fully correct (unambiguous) | ${pct(m.fullyCorrect)} | ${target('fullyCorrect')} |`,
    `| Confidently wrong date/time | ${pct(m.confidentlyWrong)} | ${target('confidentlyWrong')} |`,
    `| Clarification recall (ambiguous) | ${pct(m.clarificationRecall)} | ${target('clarificationRecall')} |`,
    `| False clarification (unambiguous) | ${pct(m.falseClarification)} | ${target('falseClarification')} |`,
    '',
    '## Field accuracy (unambiguous cases)',
    '',
    '| Field | Accuracy |',
    '|---|---|',
    ...Object.entries(m.fieldAccuracy).map(([k, v]) => `| ${k} | ${pct(v)} |`),
    '',
    '## By category (fully correct)',
    '',
    '| Category | Correct / cases |',
    '|---|---|',
    ...Object.entries(m.byCategory).map(([k, v]) => `| ${k} | ${v.correct} / ${v.cases} |`),
    '',
    '## Failures',
    '',
    ...grades
      .filter((g) => !g.correct)
      .map((g) => {
        const c = cases.find((x) => x.id === g.id)!
        const bad = Object.entries(g.fields).filter(([, ok]) => !ok).map(([k]) => k)
        return `- \`${c.input}\` (${c.nowLocal} ${c.zone}): ${g.missedClarify ? 'should have asked' : g.falseClarify ? 'asked needlessly' : `wrong ${bad.join(', ')}`}`
      }),
  ]
  return lines.join('\n') + '\n'
}

async function main() {
  const system = arg('system', 'baseline')
  const split = arg('split', 'dev') as 'dev' | 'test' | 'all'
  const cases = casesFor(split)
  const { parser, model, label } = await parserFor(system, cases)

  const grades: GradeResult[] = []
  const outputs: { id: string; result: CaptureResult; ms: number }[] = []
  const latencies: number[] = []
  let cost = 0
  for (const c of cases) {
    const t0 = performance.now()
    const { result, costUsd } = await parser(c.input, { nowLocal: c.nowLocal, zone: c.zone, projectNames: c.projectNames, tagNames: [] })
    const ms = performance.now() - t0
    latencies.push(ms)
    cost += costUsd ?? 0
    outputs.push({ id: c.id, result, ms })
    grades.push(gradeCase(c, result))
  }
  const metrics = computeMetrics(cases, grades)

  const dir = path.resolve('eval', 'results')
  fs.mkdirSync(dir, { recursive: true })
  const stem = `parse-${label}-${split}-${new Date().toISOString().slice(0, 10)}`
  fs.writeFileSync(path.join(dir, `${stem}.md`), report(label, model, split, metrics, latencies, cost, grades, cases))
  fs.writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify({ system, model, split, metrics, outputs, grades }, null, 1))
  console.log(`Fully correct ${pct(metrics.fullyCorrect)} · confidently wrong ${pct(metrics.confidentlyWrong)} · clarification recall ${pct(metrics.clarificationRecall)} · false clarification ${pct(metrics.falseClarification)}`)
  console.log(`Wrote eval/results/${stem}.md`)
}

main().catch((e: unknown) => {
  console.error((e as Error).message)
  process.exit(1)
})
