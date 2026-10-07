// The Claude capture path end to end (the real SDK, request building, schema
// parsing, validation), against the local mock server. No paid calls.
import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureWithClaude, CAPTURE_MODEL, estimateCaptureCostUsd, toCaptureResult } from './capture'
import { startMockAi, type MockAi } from './mockServer'

const ctx = { nowLocal: '2026-10-06T10:00', zone: 'America/Toronto', projectNames: ['Work', 'Home'], tagNames: ['home'] }
let mock: MockAi
let client: Anthropic

beforeEach(async () => {
  mock = await startMockAi()
  client = new Anthropic({ apiKey: 'test-key', baseURL: mock.url, maxRetries: 0 })
})
afterEach(() => mock.close())

describe('captureWithClaude (against the mock server)', () => {
  it('sends only allow-listed fields, with the weekday spelled out, and parses the structured reply', async () => {
    const { result, usage } = await captureWithClaude(client, 'Call the dentist Thursday at 3pm p2 #health', ctx)
    expect(result).toMatchObject({ kind: 'task', title: 'Call the dentist', due: { date: '2026-10-08', time: '15:00' }, priority: 2, tags: ['health'] })
    expect(mock.requests[0]!.model).toBe(CAPTURE_MODEL)
    expect(Object.keys(mock.requests[0]!.userJson).sort()).toEqual(['nowLocal', 'projectNames', 'tagNames', 'text', 'weekday', 'zone'])
    expect(mock.requests[0]!.userJson.weekday).toBe('Tuesday')
    expect(mock.requests[0]!.system).toContain('Week starts on Monday')
    expect(usage.costUsd).toBeGreaterThan(0)
  })

  it('surfaces API failures as typed SDK errors, for the caller to fall back on', async () => {
    mock.failNext(1, 429)
    await expect(captureWithClaude(client, 'x', ctx)).rejects.toBeInstanceOf(Anthropic.RateLimitError)
  })
})

describe('toCaptureResult (never trusting the model blindly)', () => {
  const base = { kind: 'task' as const, title: 'Call', due_date: '2026-10-08', due_time: '15:00', priority: 4, project_name: null, tags: [], recurrence: null, reminder_minutes_before: null, question: null }

  it('turns an invented date into a question rather than saving it', () => {
    expect(toCaptureResult({ ...base, due_date: '2026-02-30' }, 'x', ctx)).toMatchObject({ kind: 'clarify' })
  })

  it('drops a malformed time, an unknown project, an invalid priority and an invalid repeat', () => {
    const r = toCaptureResult({ ...base, due_time: '3pm', project_name: 'Secret project', priority: 9, recurrence: 'FREQ=SOMETIMES' }, 'x', ctx)
    expect(r).toMatchObject({ due: { date: '2026-10-08', time: null }, projectName: null, priority: 4, recurrence: null })
  })

  it('matches a known project case-insensitively and normalizes tags', () => {
    expect(toCaptureResult({ ...base, project_name: 'work', tags: ['#Home', 'home', 'X'] }, 'x', ctx)).toMatchObject({ projectName: 'Work', tags: ['home', 'x'] })
  })

  it('keeps a reminder only when there is a date to count back from', () => {
    expect(toCaptureResult({ ...base, due_date: null, due_time: null, reminder_minutes_before: 0 }, 'x', ctx).reminderMinutesBefore).toBeNull()
  })

  it('passes a clarifying question through, with a default if the model left it empty', () => {
    expect(toCaptureResult({ ...base, kind: 'clarify', question: null }, 'Meeting Friday', ctx)).toMatchObject({ kind: 'clarify', question: expect.stringMatching(/which day/) })
  })

  it('estimates cost before a batch', () => {
    expect(estimateCaptureCostUsd(248)).toBeCloseTo(0.41, 2)
  })
})
