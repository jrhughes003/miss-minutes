// What the UI sees of the AI features. The API key itself never appears here.

import type { CaptureResult } from '../core/capture/types'

export interface AiUsageSummary {
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export interface AiStatus {
  /** False in the plain web build (no key storage there). */
  available: boolean
  keySet: boolean
  /** The user's switch: AI on or off (the app works fully either way). */
  enabled: boolean
  /** Responses don't come from a real model (the mock server, or the demo). */
  mock: boolean
  /** The web demo: AI is simulated in the page, and no key is needed or possible. */
  simulated: boolean
  model: string
  monthToDate: AiUsageSummary
  byFeature: Record<string, AiUsageSummary>
  /** Warn above this monthly spend (USD). */
  softCapUsd: number
  /** Stop calling the API above this monthly spend (USD); null = no hard cap. */
  hardCapUsd: number | null
  overSoftCap: boolean
  /** True when the hard cap is reached: features fall back to the on-device parser. */
  blocked: boolean
  pricesAsOf: string
}

export interface AiPrefs {
  enabled?: boolean
  softCapUsd?: number
  hardCapUsd?: number | null
}

export interface CaptureResponse {
  result: CaptureResult
  /** Who understood the sentence. */
  source: 'claude' | 'device' | 'mock'
  /** Why AI wasn't used, if it could have been (e.g. offline, cap reached). */
  note: string | null
}

export const UNAVAILABLE_AI: AiStatus = {
  available: false,
  keySet: false,
  enabled: false,
  mock: false,
  simulated: false,
  model: '',
  monthToDate: { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 },
  byFeature: {},
  softCapUsd: 2,
  hardCapUsd: null,
  overSoftCap: false,
  blocked: false,
  pricesAsOf: '',
}
