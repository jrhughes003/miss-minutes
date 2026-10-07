// The data-minimization gate for AI features (PLAN.md §4, CLAUDE.md
// guardrail).
//
// Every request to Claude is built from an explicit per-feature allow-list,
// so a feature can only ever send the fields it needs. An unknown feature, or
// a field not on its list, can't slip through: unknown features throw, and
// unlisted fields are dropped. The test pins each list, so widening one is a
// deliberate, reviewed change.

export const ALLOW = {
  // Capture: the typed sentence, "now" and zone (to resolve "Thursday"), and
  // project and tag names to file the task. No other tasks, no calendar data.
  capture: ['text', 'nowLocal', 'weekday', 'zone', 'projectNames', 'tagNames'],
  // Breakdown (M7): the task itself.
  breakdown: ['title', 'notes', 'projectName', 'due'],
  // Plan my day (M10): candidate tasks and free intervals only. No event titles,
  // attendees or locations, ever.
  plan: ['tasks', 'freeIntervals', 'window', 'preference', 'nowLocal'],
} as const

export type Feature = keyof typeof ALLOW

export function buildPayload(feature: Feature, input: Record<string, unknown>): Record<string, unknown> {
  const allow = ALLOW[feature] as readonly string[] | undefined
  if (!allow) throw new Error(`Unknown AI feature: ${String(feature)}`)
  const out: Record<string, unknown> = {}
  for (const key of allow) if (input[key] !== undefined) out[key] = input[key]
  return out
}
