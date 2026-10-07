// Natural-language capture with Claude (M6).
//
// - Structured outputs (`output_config.format` with a JSON schema) guarantee
//   the reply parses into our shape. Forced tool choice is not used: current
//   Sonnet and Opus models reject it (D17).
// - Only allow-listed fields are sent (payload.ts).
// - The reply is validated again here. A malformed date or an unknown project
//   is corrected or rejected, never trusted. Any failure lets the caller fall
//   back to the deterministic parser.

import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { CAPTURE_CONVENTIONS, type CaptureContext, type CaptureResult } from '../../src/core/capture/types'
import { validateRecurrence } from '../../src/core/recurrence'
import { dayOfWeek, isLocalDate, isLocalTime } from '../../src/core/time'
import { costUsd, MODELS } from './models'
import { buildPayload } from './payload'

export const CAPTURE_MODEL = MODELS.capture

// Snake_case field names read naturally to the model; they're mapped back below.
const CaptureSchema = z.object({
  kind: z.enum(['task', 'clarify']),
  title: z.string(),
  due_date: z.string().nullable().describe('YYYY-MM-DD, or null if no date was given'),
  due_time: z.string().nullable().describe('HH:mm 24-hour, or null for an all-day task'),
  priority: z.number().int().describe('1 (urgent) to 4 (none)'),
  project_name: z.string().nullable(),
  tags: z.array(z.string()),
  recurrence: z.string().nullable().describe('RRULE body such as FREQ=WEEKLY;BYDAY=TU, or null'),
  reminder_minutes_before: z.number().int().nullable(),
  question: z.string().nullable().describe('When kind is clarify: one short question to ask'),
})

// Stable text first, so it can be cached once it's long enough to qualify.
const SYSTEM = `You turn one sentence a person typed into a structured to-do item for their task app.

Follow these conventions exactly:
${CAPTURE_CONVENTIONS}

Rules:
- Resolve relative dates against "nowLocal" (the user's local date and time) and its weekday.
- If the date or time is genuinely ambiguous under the conventions, return kind "clarify" with one short question. Otherwise return kind "task". Never guess a date you are unsure about.
- Only use a project name from "projectNames"; otherwise project_name is null.
- Tags are lower-case words without "#".
- Keep the title short and in the user's words; drop the date, time, priority, tags, project and "remind me to".`

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface CaptureUsage {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  latencyMs: number
}

export class CaptureRefusedError extends Error {}

export async function captureWithClaude(client: Anthropic, text: string, ctx: CaptureContext): Promise<{ result: CaptureResult; usage: CaptureUsage }> {
  const payload = buildPayload('capture', {
    text,
    nowLocal: ctx.nowLocal,
    weekday: WEEKDAYS[dayOfWeek(ctx.nowLocal.slice(0, 10))],
    zone: ctx.zone,
    projectNames: ctx.projectNames,
    tagNames: ctx.tagNames,
  })
  const started = Date.now()
  const response = await client.messages.parse({
    model: CAPTURE_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    output_config: { format: zodOutputFormat(CaptureSchema) },
  })
  const usage: CaptureUsage = {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    costUsd: costUsd(CAPTURE_MODEL, response.usage),
    latencyMs: Date.now() - started,
  }
  if (response.stop_reason === 'refusal') throw new CaptureRefusedError('Claude declined this request.')
  const out = response.parsed_output
  if (!out) throw new Error('Claude returned output that did not match the capture schema.')
  return { result: toCaptureResult(out, text, ctx), usage }
}

/** Maps and re-validates the model's answer. Anything invalid is dropped rather than trusted. */
export function toCaptureResult(out: z.infer<typeof CaptureSchema>, text: string, ctx: CaptureContext): CaptureResult {
  if (out.kind === 'clarify') {
    return { kind: 'clarify', title: out.title || text, due: null, priority: 4, projectName: null, tags: [], recurrence: null, reminderMinutesBefore: null, question: out.question || 'Could you say exactly which day you mean?' }
  }
  const dateOk = out.due_date !== null && isLocalDate(out.due_date)
  const timeOk = out.due_time !== null && isLocalTime(out.due_time)
  // A date that fails validation means the model invented something: ask rather than save it.
  if (out.due_date !== null && !dateOk) {
    return { kind: 'clarify', title: out.title || text, due: null, priority: 4, projectName: null, tags: [], recurrence: null, reminderMinutesBefore: null, question: 'Which date did you mean?' }
  }
  const recurrence = out.recurrence && !validateRecurrence({ kind: 'rule', rrule: out.recurrence }) ? out.recurrence.toUpperCase().replace(/^RRULE:/, '') : null
  const project = ctx.projectNames.find((p) => p.toLowerCase() === (out.project_name ?? '').toLowerCase()) ?? null
  const priority = [1, 2, 3, 4].includes(out.priority) ? (out.priority as 1 | 2 | 3 | 4) : 4
  const reminder = out.reminder_minutes_before !== null && out.reminder_minutes_before >= 0 && out.reminder_minutes_before <= 40_320 ? out.reminder_minutes_before : null
  return {
    kind: 'task',
    title: out.title.trim() || text.trim(),
    due: dateOk ? { date: out.due_date!, time: timeOk ? out.due_time : null } : null,
    priority,
    projectName: project,
    tags: [...new Set(out.tags.map((t) => t.replace(/^#/, '').toLowerCase()).filter(Boolean))],
    recurrence: dateOk ? recurrence : null,
    // A reminder needs something to count back from.
    reminderMinutesBefore: dateOk ? reminder : null,
    question: null,
  }
}

/** A rough cost estimate before running many captures (about 900 input and 150 output tokens each on Haiku 4.5). */
export function estimateCaptureCostUsd(n: number): number {
  return (n * (900 * 1 + 150 * 5)) / 1_000_000
}
