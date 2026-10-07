// A small client for the Google REST APIs the app uses.
//
// Two kinds of failure are handled here so callers don't have to:
// - 401 (access token expired or revoked mid-flight): refresh once and retry.
// - Rate limits and server errors (429, 403 rateLimitExceeded, 5xx): retry with
//   exponential backoff plus random jitter, as Google's quota guide asks
//   (D11). Jitter matters because many clients retrying on the same schedule
//   would hit the server in lockstep.

import type { GoogleCalendarListEntry, GoogleEvent } from '../../src/core/calendar/google'
import type { GoogleEndpoints } from './oauth'

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleApiError'
  }
}

export interface GoogleApiOptions {
  fetch: typeof fetch
  endpoints: GoogleEndpoints
  auth: { accessToken(): Promise<string>; invalidateAccessToken(): void }
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  maxRetries?: number
}

/** Delay before retry number `attempt` (0-based): 1 s, 2 s, 4 s, … plus up to 1 s jitter, capped at 32 s. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  return Math.min(2 ** attempt * 1000 + Math.floor(random() * 1000), 32_000)
}

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'])

export class GoogleApi {
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly o: GoogleApiOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  async getJson<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = `${this.o.endpoints.api}${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`
    const maxRetries = this.o.maxRetries ?? 5
    let reauthorized = false
    for (let attempt = 0; ; attempt++) {
      const token = await this.o.auth.accessToken()
      const res = await this.o.fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (res.ok) return (await res.json()) as T

      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } }
      const reason = body.error?.errors?.[0]?.reason ?? ''
      if (res.status === 401 && !reauthorized) {
        reauthorized = true
        this.o.auth.invalidateAccessToken()
        continue
      }
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && RATE_LIMIT_REASONS.has(reason))
      if (retryable && attempt < maxRetries) {
        await this.sleep(backoffMs(attempt, this.o.random))
        continue
      }
      throw new GoogleApiError(res.status, body.error?.message ?? `Google API request failed (${res.status})`)
    }
  }

  /** Follows nextPageToken until the list is complete. */
  private async all<T>(path: string, query: Record<string, string>): Promise<T[]> {
    const out: T[] = []
    let pageToken: string | undefined
    do {
      const page = await this.getJson<{ items?: T[]; nextPageToken?: string }>(path, pageToken ? { ...query, pageToken } : query)
      out.push(...(page.items ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return out
  }

  listCalendars(): Promise<GoogleCalendarListEntry[]> {
    return this.all('/calendar/v3/users/me/calendarList', { maxResults: '250' })
  }

  /** Every event instance overlapping [timeMin, timeMax), with recurring events expanded by Google (D11). */
  listEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<GoogleEvent[]> {
    return this.all(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: '250',
    })
  }
}
