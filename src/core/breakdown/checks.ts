// Task breakdown: splitting a vague task into concrete next steps (M7).
//
// These checks define a well-formed step list (PLAN.md §5.4). They're used in
// two places:
// - the breakdown eval scores Claude's output with them;
// - the app filters suggestions through them before showing anything, so a
//   malformed suggestion never reaches the user.
//
// They're deliberately mechanical. Whether the steps are *useful* is left to
// a human rating (PLAN §5.4); code checks only the shape.

import * as chronoModule from 'chrono-node'

type ChronoModule = typeof chronoModule
const chrono: ChronoModule = (chronoModule as unknown as { default?: ChronoModule }).default ?? chronoModule

export const STEP_LIMITS = { min: 3, max: 7, chars: 80 } as const

/**
 * Words that can't begin an instruction. "Starts with a verb" is approximated
 * by "doesn't start with one of these". A full verb dictionary would be
 * brittle, and the shape that matters ("Book the van", not "The van booking")
 * is caught by excluding articles, pronouns, determiners, numbers and similar.
 */
const NON_VERB_STARTERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their', 'his', 'her', 'its',
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'there', 'here', 'some', 'any', 'all', 'each', 'every',
  'step', 'first', 'second', 'third', 'next', 'then', 'finally', 'also', 'and', 'or', 'but', 'if', 'when',
  'to', 'for', 'with', 'by', 'on', 'in', 'at', 'of', 'from', 'about', 'after', 'before',
  'is', 'are', 'was', 'be', 'been', 'should', 'must', 'can', 'could', 'would', 'will', 'maybe',
])

export interface StepCheck {
  ok: boolean
  problems: string[]
}

/** Checks one step. `taskText` is the task's own wording, so a date it already contains doesn't count as invented. */
export function checkStep(step: string, taskText = ''): StepCheck {
  const problems: string[] = []
  const s = step.trim()
  if (!s) problems.push('empty')
  if (s.length > STEP_LIMITS.chars) problems.push(`longer than ${STEP_LIMITS.chars} characters`)
  const first = s.split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}]/gu, '') ?? ''
  if (!first || NON_VERB_STARTERS.has(first) || /^\d/.test(s) || /ing$/.test(first)) problems.push('does not start with an instruction verb')
  if (/^[-*•\d]+[.)]?\s/.test(s)) problems.push('has list numbering or a bullet')
  // A date or time that the task itself didn't mention was invented by the model.
  for (const found of chrono.parse(s)) {
    if (!taskText.toLowerCase().includes(found.text.toLowerCase())) problems.push(`mentions a date or time ("${found.text}") the task didn't`)
  }
  return { ok: problems.length === 0, problems }
}

export interface ListCheck {
  ok: boolean
  problems: string[]
  perStep: StepCheck[]
}

export function checkSteps(steps: string[], taskText = ''): ListCheck {
  const problems: string[] = []
  if (steps.length < STEP_LIMITS.min || steps.length > STEP_LIMITS.max) problems.push(`${steps.length} steps (want ${STEP_LIMITS.min}–${STEP_LIMITS.max})`)
  const seen = new Set<string>()
  for (const s of steps) {
    const key = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (seen.has(key)) problems.push(`duplicate step "${s}"`)
    seen.add(key)
  }
  const perStep = steps.map((s) => checkStep(s, taskText))
  const ok = problems.length === 0 && perStep.every((c) => c.ok)
  return { ok, problems, perStep }
}

/** Tidies a model's steps before checking: trims, strips numbering and trailing full stops. */
export function tidySteps(steps: string[]): string[] {
  return steps
    .map((s) => s.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '').replace(/\.$/, '').trim())
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
}
