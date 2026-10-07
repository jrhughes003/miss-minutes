// A small client for the Google REST APIs the app uses.
//
// Two kinds of failure are handled here so callers don't have to:
// - 401 (access token expired or revoked mid-flight): refresh once and retry.
// - Rate limits and server errors (429, 403 rateLimitExceeded, 5xx): retry with
//   exponential backoff plus random jitter, as Google's quota guide asks
//   (D11). Jitter matters because many clients retrying on the same schedule
//   would hit the server in lockstep.

import type { GoogleCalendarListEntry, GoogleEvent } from '../../src/core/calendar/google'
import type { GoogleTask, GoogleTaskList, GoogleTaskWrite } from '../../src/core/sync/googleTasks'
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

  getJson<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    return this.request<T>('GET', path, query)
  }

  /**
   * One API call with the retry rules above. Inserts (POST) are retried only
   * on rate limits, where Google rejected the request before doing anything.
   * After a server error an insert may or may not have happened, and
   * retrying blindly could create a duplicate. The Tasks sync's outbox
   * resolves that case instead (D13).
   */
  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
    const url = `${this.o.endpoints.api}${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`
    const maxRetries = this.o.maxRetries ?? 5
    let reauthorized = false
    for (let attempt = 0; ; attempt++) {
      const token = await this.o.auth.accessToken()
      const res = await this.o.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (res.ok) return (res.status === 204 ? undefined : await res.json().catch(() => undefined)) as T

      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } }
      const reason = err.error?.errors?.[0]?.reason ?? ''
      if (res.status === 401 && !reauthorized) {
        reauthorized = true
        this.o.auth.invalidateAccessToken()
        continue
      }
      const rateLimited = res.status === 429 || (res.status === 403 && RATE_LIMIT_REASONS.has(reason))
      const retryable = rateLimited || (res.status >= 500 && method !== 'POST')
      if (retryable && attempt < maxRetries) {
        await this.sleep(backoffMs(attempt, this.o.random))
        continue
      }
      throw new GoogleApiError(res.status, err.error?.message ?? `Google API request failed (${res.status})`)
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

  // ---- Google Tasks -----------------------------------------------------------

  listTaskLists(): Promise<GoogleTaskList[]> {
    return this.all('/tasks/v1/users/@me/lists', { maxResults: '100' })
  }

  /** The user's default list ("My Tasks"), which the Inbox syncs to (D31). */
  defaultTaskList(): Promise<GoogleTaskList> {
    return this.getJson('/tasks/v1/users/@me/lists/%40default')
  }

  insertTaskList(title: string): Promise<GoogleTaskList> {
    return this.request('POST', '/tasks/v1/users/@me/lists', {}, { title })
  }

  /** Tasks changed since `updatedMin` (or all, without it), including deleted and hidden ones. */
  listTasks(listId: string, updatedMin?: string): Promise<GoogleTask[]> {
    return this.all(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, {
      maxResults: '100',
      showCompleted: 'true',
      showHidden: 'true',
      showDeleted: 'true',
      ...(updatedMin ? { updatedMin } : {}),
    })
  }

  insertTask(listId: string, task: GoogleTaskWrite, parent?: string): Promise<GoogleTask> {
    return this.request('POST', `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, parent ? { parent } : {}, task)
  }

  patchTask(listId: string, taskId: string, patch: GoogleTaskWrite): Promise<GoogleTask> {
    return this.request('PATCH', `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {}, patch)
  }

  deleteTask(listId: string, taskId: string): Promise<void> {
    return this.request('DELETE', `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`)
  }

  /** Moves a task to another list (when its project changes here). */
  moveTask(listId: string, taskId: string, destinationList: string): Promise<GoogleTask> {
    return this.request('POST', `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/move`, { destinationTasklist: destinationList })
  }

  // ---- Calendar writes (M9) -----------------------------------------------------

  /** Creates a secondary calendar owned by the user (needs calendar.app.created). */
  insertCalendar(summary: string, timeZone: string): Promise<{ id: string; summary: string }> {
    return this.request('POST', '/calendar/v3/calendars', {}, { summary, timeZone })
  }

  /**
   * Creates an event with a client-chosen id. Google answers 409 if that id
   * already exists, which makes a retried create harmless (D12).
   */
  insertEvent(calendarId: string, event: GoogleEvent): Promise<GoogleEvent> {
    return this.request('POST', `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {}, event)
  }

  patchEvent(calendarId: string, eventId: string, patch: Partial<GoogleEvent>): Promise<GoogleEvent> {
    return this.request('PATCH', `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {}, patch)
  }

  deleteEvent(calendarId: string, eventId: string): Promise<void> {
    return this.request('DELETE', `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)
  }
}
