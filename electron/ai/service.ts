// AI in the main process: the key, the on/off switch, spending caps, the
// usage log, and capture with an automatic on-device fallback.
//
// The app must work with AI off (CLAUDE.md guardrail), so capture never
// fails because of AI. If there's no key, AI is switched off, the hard cap is
// reached, or the API errors, the deterministic parser answers instead and
// the response says why.

import Anthropic from '@anthropic-ai/sdk'
import { parseBaseline } from '../../src/core/capture/baseline'
import type { CaptureContext } from '../../src/core/capture/types'
import type { Clock } from '../../src/core/clock'
import type { SettingsStore } from '../../src/core/settings'
import type { AiPrefs, AiStatus, AiUsageSummary, CaptureResponse } from '../../src/shared/ai'
import type { SqlDatabase } from '../db/database'
import type { SecretStore } from '../google/secrets'
import { captureWithClaude, CaptureRefusedError, type CaptureUsage } from './capture'
import { MODELS, PRICES_AS_OF } from './models'

const KEY = 'anthropic.apiKey'

export class AiService {
  private readonly insert
  private readonly monthRows

  constructor(
    private readonly o: {
      db: SqlDatabase
      secrets: SecretStore
      settings: SettingsStore
      clock: Clock
      /** Mock server URL (development and tests). Unset: the real API. */
      baseURL?: string | undefined
    },
  ) {
    this.insert = o.db.prepare(`
      INSERT INTO ai_usage (at, feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, ok)
      VALUES (@at, @feature, @model, @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens, @cost_usd, @latency_ms, @ok)`)
    this.monthRows = o.db.prepare('SELECT feature, COUNT(*) AS calls, SUM(cost_usd) AS cost, SUM(input_tokens) AS input, SUM(output_tokens) AS output FROM ai_usage WHERE at >= @since GROUP BY feature')
  }

  // ---- Key and preferences --------------------------------------------------

  setKey(key: string): AiStatus {
    const k = key.trim()
    // Shape check only. The key is never logged or sent back to the page.
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error('That doesn’t look like an Anthropic API key (it should start with "sk-ant-").')
    this.o.secrets.set(KEY, k)
    return this.status()
  }

  clearKey(): AiStatus {
    this.o.secrets.delete(KEY)
    return this.status()
  }

  setPrefs(p: AiPrefs): AiStatus {
    if (p.enabled !== undefined) this.o.settings.set('ai.enabled', String(Boolean(p.enabled)))
    if (p.softCapUsd !== undefined) {
      if (!Number.isFinite(p.softCapUsd) || p.softCapUsd < 0) throw new Error('The warning amount must be zero or more.')
      this.o.settings.set('ai.softCapUsd', String(p.softCapUsd))
    }
    if (p.hardCapUsd !== undefined) {
      if (p.hardCapUsd !== null && (!Number.isFinite(p.hardCapUsd) || p.hardCapUsd < 0)) throw new Error('The limit must be zero or more.')
      this.o.settings.set('ai.hardCapUsd', p.hardCapUsd === null ? '' : String(p.hardCapUsd))
    }
    return this.status()
  }

  // ---- Status ---------------------------------------------------------------

  private monthStart(): string {
    const now = this.o.clock.now()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  }

  status(): AiStatus {
    const byFeature: Record<string, AiUsageSummary> = {}
    const total: AiUsageSummary = { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 }
    for (const r of this.monthRows.all({ since: this.monthStart() })) {
      const s = { calls: Number(r.calls), costUsd: Number(r.cost ?? 0), inputTokens: Number(r.input ?? 0), outputTokens: Number(r.output ?? 0) }
      byFeature[String(r.feature)] = s
      total.calls += s.calls
      total.costUsd += s.costUsd
      total.inputTokens += s.inputTokens
      total.outputTokens += s.outputTokens
    }
    const soft = Number(this.o.settings.get('ai.softCapUsd') ?? 2)
    const hardRaw = this.o.settings.get('ai.hardCapUsd')
    const hard = hardRaw ? Number(hardRaw) : null
    return {
      available: true,
      keySet: this.o.secrets.get(KEY) !== null,
      enabled: this.o.settings.get('ai.enabled') !== 'false',
      mock: Boolean(this.o.baseURL),
      simulated: false,
      model: MODELS.capture,
      monthToDate: total,
      byFeature,
      softCapUsd: soft,
      hardCapUsd: hard,
      overSoftCap: total.costUsd >= soft,
      blocked: hard !== null && total.costUsd >= hard,
      pricesAsOf: PRICES_AS_OF,
    }
  }

  // ---- Capture ----------------------------------------------------------------

  async capture(text: string, ctx: CaptureContext): Promise<CaptureResponse> {
    const device = (note: string | null): CaptureResponse => ({ result: parseBaseline(text, ctx), source: 'device', note })
    const status = this.status()
    if (!status.keySet) return device(null)
    if (!status.enabled) return device(null)
    if (status.blocked) return device('Your monthly AI limit is reached, so this was understood on this device.')

    const apiKey = this.o.secrets.get(KEY)!
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 2, ...(this.o.baseURL ? { baseURL: this.o.baseURL } : {}) })
    try {
      const { result, usage } = await captureWithClaude(client, text, ctx)
      this.log('capture', usage, true)
      return { result, source: this.o.baseURL ? 'mock' : 'claude', note: null }
    } catch (e) {
      let note = 'Claude was unavailable, so this was understood on this device.'
      if (e instanceof Anthropic.AuthenticationError) note = 'The API key was rejected. Check it in Settings → AI. Understood on this device instead.'
      else if (e instanceof Anthropic.RateLimitError) note = 'Claude is rate-limited right now; understood on this device instead.'
      else if (e instanceof CaptureRefusedError) note = 'Claude declined this one; understood on this device instead.'
      this.log('capture', { model: MODELS.capture, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, latencyMs: 0 }, false)
      return device(note)
    }
  }

  private log(feature: string, u: CaptureUsage, ok: boolean): void {
    this.insert.run({
      at: this.o.clock.now().toISOString(),
      feature,
      model: u.model,
      input_tokens: u.inputTokens,
      output_tokens: u.outputTokens,
      cache_read_tokens: u.cacheReadTokens,
      cache_write_tokens: u.cacheWriteTokens,
      cost_usd: u.costUsd,
      latency_ms: u.latencyMs,
      ok: ok ? 1 : 0,
    })
  }
}
