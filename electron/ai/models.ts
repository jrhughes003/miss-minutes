// Model choice and prices, in one place (D17).
//
// Model IDs come from Anthropic's model table (checked 2026-10-06 via the
// claude-api reference, cached 2026-09-25), never from memory. Every feature
// starts on the cheapest current model; plan-my-day may move up only if the
// eval says Haiku misses its targets (D17).

export const MODELS = {
  capture: 'claude-haiku-4-5',
  breakdown: 'claude-haiku-4-5',
  plan: 'claude-haiku-4-5',
} as const

export type ModelId = (typeof MODELS)[keyof typeof MODELS] | 'claude-sonnet-5-5'

/** US dollars per million tokens, as of 2026-09-25. Cache reads bill at 0.1× input, cache writes (5-minute) at 1.25×. */
export const PRICES: Record<ModelId, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
}
export const PRICES_AS_OF = '2026-09-25'

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function costUsd(model: ModelId, u: TokenUsage): number {
  const p = PRICES[model]
  const cacheRead = u.cache_read_input_tokens ?? 0
  const cacheWrite = u.cache_creation_input_tokens ?? 0
  return (u.input_tokens * p.input + cacheRead * p.input * 0.1 + cacheWrite * p.input * 1.25 + u.output_tokens * p.output) / 1_000_000
}
