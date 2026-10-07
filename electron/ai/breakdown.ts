// Task breakdown with Claude (M7): a vague task in, 3–7 concrete next steps out.
//
// Same pattern as capture: structured outputs (no forced tool choice), only
// allow-listed fields sent, and the reply checked again in code. Steps that
// fail the shape checks (core/breakdown/checks.ts) are dropped rather than
// shown.

import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { checkStep, STEP_LIMITS, tidySteps } from '../../src/core/breakdown/checks'
import type { CaptureUsage } from './capture'
import { costUsd, MODELS } from './models'
import { buildPayload } from './payload'

export const BREAKDOWN_MODEL = MODELS.breakdown

const BreakdownSchema = z.object({ steps: z.array(z.string()) })

const SYSTEM = `You split one to-do item into concrete next steps for the person who wrote it.

Rules:
- Return ${STEP_LIMITS.min} to ${STEP_LIMITS.max} steps, in the order they'd be done.
- Each step starts with an imperative verb ("Book", "Email", "List") and is at most ${STEP_LIMITS.chars} characters.
- Each step is a single physical or digital action someone could start right away.
- Don't add dates, times or deadlines that the task doesn't mention.
- No numbering, bullets or explanations; no duplicate steps.
- Write in the same language as the task.`

export interface BreakdownInput {
  title: string
  notes?: string
  projectName?: string | null
  due?: string | null
}

export async function breakdownWithClaude(client: Anthropic, input: BreakdownInput): Promise<{ raw: string[]; steps: string[]; usage: CaptureUsage }> {
  const payload = buildPayload('breakdown', { ...input })
  const started = Date.now()
  const response = await client.messages.parse({
    model: BREAKDOWN_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    output_config: { format: zodOutputFormat(BreakdownSchema) },
  })
  const usage: CaptureUsage = {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    costUsd: costUsd(BREAKDOWN_MODEL, response.usage),
    latencyMs: Date.now() - started,
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.')
  if (!response.parsed_output) throw new Error('Claude returned output that did not match the breakdown schema.')
  const raw = tidySteps(response.parsed_output.steps)
  const context = `${input.title} ${input.notes ?? ''}`
  const seen = new Set<string>()
  const steps = raw.filter((s) => {
    const key = s.toLowerCase()
    if (seen.has(key) || !checkStep(s, context).ok) return false
    seen.add(key)
    return true
  }).slice(0, STEP_LIMITS.max)
  return { raw, steps, usage }
}

export function estimateBreakdownCostUsd(n: number): number {
  return (n * (500 * 1 + 120 * 5)) / 1_000_000
}
