import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkSteps } from '../../src/core/breakdown/checks'
import { BREAKDOWN_CASES } from '../../eval/breakdown/cases'
import { breakdownWithClaude } from './breakdown'
import { startMockAi, type MockAi } from './mockServer'

let mock: MockAi
let client: Anthropic
beforeEach(async () => {
  mock = await startMockAi()
  client = new Anthropic({ apiKey: 'test', baseURL: mock.url, maxRetries: 0 })
})
afterEach(() => mock.close())

describe('breakdownWithClaude (against the mock server)', () => {
  it('sends only the allow-listed task fields and returns checked steps', async () => {
    const r = await breakdownWithClaude(client, { title: 'Move house', notes: 'Two bedrooms', projectName: 'Home', due: '2026-11-28' })
    expect(Object.keys(mock.requests[0]!.userJson).sort()).toEqual(['due', 'notes', 'projectName', 'title'])
    expect(r.steps.length).toBeGreaterThanOrEqual(3)
    expect(checkSteps(r.steps, 'Move house').ok).toBe(true)
  })
})

describe('the frozen breakdown case set', () => {
  it('has 40 tasks, 20 of them for hand rating, with unique ids', () => {
    expect(BREAKDOWN_CASES).toHaveLength(40)
    expect(BREAKDOWN_CASES.filter((c) => c.rate)).toHaveLength(20)
    expect(new Set(BREAKDOWN_CASES.map((c) => c.id)).size).toBe(40)
  })
})
