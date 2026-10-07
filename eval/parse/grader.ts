// ===========================================================================
// The parse-eval grader (teaching module, D25)
// ===========================================================================
//
// What it does: decides, with no AI involved, whether one parser output is
// right for one eval case, and adds up the results into the pre-registered
// metrics from PLAN.md §5.1.
//
// Why a program and not an LLM judge: an LLM judge can be inconsistent, can
// be swayed by phrasing, and makes "correct" depend on a second model.
// Everything this eval checks has a single right answer under the written
// conventions (a date, a time, an RRULE, a priority), so code can check it
// exactly and repeatably. Only the title is fuzzy, and for that we use a
// simple, explainable score (token F1, below) with a fixed threshold.
//
// How to read the result of one case:
// - `correct`: every field matches. This is the headline "fully correct" metric.
// - `confidentlyWrong`: the parser didn't ask, and the due date or time it
//   produced is wrong. This is the most important failure, because the user
//   gets no hint that anything is off and the task silently lands on the
//   wrong day.
// - `falseClarify` / `missedClarify`: asking when it shouldn't have, or
//   guessing when it should have asked.
// ===========================================================================

import { previewOccurrences } from '../../src/core/recurrence'
import type { CaptureResult } from '../../src/core/capture/types'
import type { Expected, ParseCase } from './cases'

/** Below this token-F1 score a title counts as wrong. Fixed before any results (PLAN §5.1). */
export const TITLE_F1_THRESHOLD = 0.8

export interface FieldChecks {
  kind: boolean
  title: boolean
  due: boolean
  priority: boolean
  project: boolean
  tags: boolean
  recurrence: boolean
  reminder: boolean
}

export interface GradeResult {
  id: string
  correct: boolean
  fields: FieldChecks
  titleF1: number
  /** Answered as a task, but with the wrong due date or time. */
  confidentlyWrong: boolean
  /** Asked a question although the case was unambiguous. */
  falseClarify: boolean
  /** Guessed although the case was ambiguous. */
  missedClarify: boolean
}

// ---------------------------------------------------------------------------
// Titles: token F1
//
// Split both titles into lower-case words (punctuation dropped), then:
//   precision = shared words / words in the parser's title
//   recall    = shared words / words in the expected title
//   F1        = 2·P·R / (P + R)   (the harmonic mean, 1.0 = identical words)
// A title that keeps an extra word ("Call the dentist Thursday") or drops one
// still scores high; one that's mostly wrong scores low. Words are counted
// with multiplicity, so "the the" doesn't match "the" twice.
// ---------------------------------------------------------------------------

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function titleF1(expected: string, actual: string): number {
  const exp = tokens(expected)
  const act = tokens(actual)
  if (exp.length === 0 && act.length === 0) return 1
  if (exp.length === 0 || act.length === 0) return 0
  // Count shared words with multiplicity.
  const pool = new Map<string, number>()
  for (const w of exp) pool.set(w, (pool.get(w) ?? 0) + 1)
  let shared = 0
  for (const w of act) {
    const left = pool.get(w) ?? 0
    if (left > 0) {
      shared++
      pool.set(w, left - 1)
    }
  }
  if (shared === 0) return 0
  const precision = shared / act.length
  const recall = shared / exp.length
  return (2 * precision * recall) / (precision + recall)
}

// ---------------------------------------------------------------------------
// Repeat rules: equivalence by occurrences
//
// Two RRULE strings can mean the same thing yet be written differently:
// "FREQ=MONTHLY" starting on the 15th and "FREQ=MONTHLY;BYMONTHDAY=15" both
// mean "the 15th of each month". Comparing the strings would wrongly fail
// one of them. So both rules are expanded from the same start date (the
// expected first occurrence), and the next 10 dates are compared. Same
// dates, same rule.
// ---------------------------------------------------------------------------

export const RECURRENCE_HORIZON = 10

export function recurrenceEquivalent(expected: string | null, actual: string | null, anchor: CaptureResult['due']): boolean {
  if (expected === null || actual === null) return expected === actual
  if (!anchor) return false // a repeat with no start date can't be compared (or used)
  try {
    const a = previewOccurrences(anchor, expected, RECURRENCE_HORIZON)
    const b = previewOccurrences(anchor, actual, RECURRENCE_HORIZON)
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false // an unparseable rule from the parser is simply wrong
  }
}

// ---------------------------------------------------------------------------
// One case
// ---------------------------------------------------------------------------

const sameDue = (a: CaptureResult['due'] | undefined, b: CaptureResult['due'] | undefined) =>
  (a ?? null) === null || (b ?? null) === null ? (a ?? null) === (b ?? null) : a!.date === b!.date && a!.time === b!.time

const sameTags = (a: string[], b: string[]) => JSON.stringify([...a].map((t) => t.toLowerCase()).sort()) === JSON.stringify([...b].map((t) => t.toLowerCase()).sort())

export function gradeCase(c: Pick<ParseCase, 'id' | 'expected'>, actual: CaptureResult): GradeResult {
  const e: Expected = c.expected

  // An ambiguous case is graded on one thing only: did the parser ask?
  if (e.kind === 'clarify') {
    const asked = actual.kind === 'clarify'
    const all = { kind: asked, title: true, due: true, priority: true, project: true, tags: true, recurrence: true, reminder: true }
    return { id: c.id, correct: asked, fields: all, titleF1: 1, confidentlyWrong: false, falseClarify: false, missedClarify: !asked }
  }

  // An unambiguous case asked about anyway: every field counts as missing.
  if (actual.kind === 'clarify') {
    const none = { kind: false, title: false, due: false, priority: false, project: false, tags: false, recurrence: false, reminder: false }
    return { id: c.id, correct: false, fields: none, titleF1: 0, confidentlyWrong: false, falseClarify: true, missedClarify: false }
  }

  const f1 = titleF1(e.title ?? '', actual.title)
  const fields: FieldChecks = {
    kind: true,
    title: f1 >= TITLE_F1_THRESHOLD,
    due: sameDue(e.due, actual.due),
    priority: (e.priority ?? 4) === actual.priority,
    // Project names compare case-insensitively ("work" = "Work").
    project: (e.projectName ?? null)?.toLowerCase() === (actual.projectName ?? null)?.toLowerCase(),
    tags: sameTags(e.tags ?? [], actual.tags),
    recurrence: recurrenceEquivalent(e.recurrence ?? null, actual.recurrence, e.due ?? null),
    reminder: (e.reminderMinutesBefore ?? null) === actual.reminderMinutesBefore,
  }
  const correct = Object.values(fields).every(Boolean)
  return {
    id: c.id,
    correct,
    fields,
    titleF1: f1,
    // Wrong date or time, delivered without a question: the dangerous error.
    confidentlyWrong: !fields.due,
    falseClarify: false,
    missedClarify: false,
  }
}

// ---------------------------------------------------------------------------
// The metrics (PLAN.md §5.1)
// ---------------------------------------------------------------------------

export interface Metrics {
  cases: number
  unambiguous: number
  ambiguous: number
  /** Share of unambiguous cases with every field right. Target for Claude ≥ 0.95. */
  fullyCorrect: number
  /** Share of unambiguous cases answered with a wrong date/time and no question. Target ≤ 0.02. */
  confidentlyWrong: number
  /** Share of ambiguous cases where the parser asked. Target ≥ 0.85. */
  clarificationRecall: number
  /** Share of unambiguous cases where the parser asked needlessly. Target ≤ 0.05. */
  falseClarification: number
  /** Per-field accuracy on unambiguous cases, to see where errors come from. */
  fieldAccuracy: Record<keyof FieldChecks, number>
  /** Fully-correct share per category. */
  byCategory: Record<string, { cases: number; correct: number }>
}

export function computeMetrics(cases: Pick<ParseCase, 'id' | 'expected' | 'category'>[], grades: GradeResult[]): Metrics {
  const byId = new Map(grades.map((g) => [g.id, g]))
  const unamb = cases.filter((c) => c.expected.kind === 'task')
  const amb = cases.filter((c) => c.expected.kind === 'clarify')
  const g = (c: { id: string }) => {
    const r = byId.get(c.id)
    if (!r) throw new Error(`No grade for case ${c.id}`)
    return r
  }
  const share = (n: number, d: number) => (d === 0 ? 0 : n / d)

  const fieldAccuracy = {} as Record<keyof FieldChecks, number>
  for (const k of ['kind', 'title', 'due', 'priority', 'project', 'tags', 'recurrence', 'reminder'] as const) {
    fieldAccuracy[k] = share(unamb.filter((c) => g(c).fields[k]).length, unamb.length)
  }
  const byCategory: Metrics['byCategory'] = {}
  for (const c of cases) {
    const b = (byCategory[c.category] ??= { cases: 0, correct: 0 })
    b.cases++
    if (g(c).correct) b.correct++
  }

  return {
    cases: cases.length,
    unambiguous: unamb.length,
    ambiguous: amb.length,
    fullyCorrect: share(unamb.filter((c) => g(c).correct).length, unamb.length),
    confidentlyWrong: share(unamb.filter((c) => g(c).confidentlyWrong).length, unamb.length),
    clarificationRecall: share(amb.filter((c) => g(c).correct).length, amb.length),
    falseClarification: share(unamb.filter((c) => g(c).falseClarify).length, unamb.length),
    fieldAccuracy,
    byCategory,
  }
}

/** The pre-registered targets for Claude (PLAN.md §5.1). The baseline is reported, not targeted. */
export const TARGETS = {
  fullyCorrect: { op: '>=', value: 0.95 },
  confidentlyWrong: { op: '<=', value: 0.02 },
  clarificationRecall: { op: '>=', value: 0.85 },
  falseClarification: { op: '<=', value: 0.05 },
} as const

/**
 * The ship rule (PLAN.md §5.1): Claude becomes the default capture only if it
 * beats the baseline by at least 10 percentage points on fully-correct cases
 * AND is confidently wrong no more often than the baseline.
 */
export function shipRule(claude: Metrics, baseline: Metrics): { ship: boolean; reasons: string[] } {
  const reasons: string[] = []
  const margin = claude.fullyCorrect - baseline.fullyCorrect
  if (margin < 0.1) reasons.push(`fully-correct margin over baseline is ${(margin * 100).toFixed(1)} pp (needs ≥ 10 pp)`)
  if (claude.confidentlyWrong > baseline.confidentlyWrong) reasons.push('confidently wrong more often than the baseline')
  return { ship: reasons.length === 0, reasons }
}
