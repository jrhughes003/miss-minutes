// A local stand-in for Google's OAuth and Calendar endpoints, for tests and
// `npm run electron:dev:fake-google`. It is never bundled into the app.
//
// It behaves like the real service where that matters to us:
// - PKCE is really checked: the token endpoint rejects a code_verifier whose
//   SHA-256 doesn't match the challenge sent at sign-in.
// - Codes are single-use; refresh tokens can be revoked (→ invalid_grant,
//   which is also how the 7-day Testing-mode expiry shows up).
// - Each API call needs a valid, unexpired access token carrying the right
//   scope.
// - Lists are paged with nextPageToken; events honour timeMin/timeMax and
//   require singleEvents=true (the only mode the app uses, D11).
// - It can inject 429 rate-limit responses, to test backoff.
//
// Calendar data comes from the same seeded generator as the web demo,
// converted to Google's JSON, plus one cancelled instance to be filtered out.

import { createHash, randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GoogleCalendarListEntry, GoogleEvent } from '../../src/core/calendar/google'
import type { GoogleTask, GoogleTaskList } from '../../src/core/sync/googleTasks'
import type { CalendarEvent } from '../../src/core/today'
import { FAKE_CALENDARS, generateFakeCalendar } from '../../src/demo/fakeCalendar'
import type { GoogleEndpoints } from './oauth'

export const FAKE_CLIENT = { clientId: 'fake-client.apps.googleusercontent.com', clientSecret: 'fake-secret' }

// Real-world calendar ids contain '@' and '#', which must be URL-encoded in paths.
const CALENDAR_IDS: Record<string, string> = {
  work: 'me@example.com',
  personal: 'personal#abc@group.calendar.google.com',
  family: 'family@group.calendar.google.com',
}

export interface FakeGoogleOptions {
  today: string
  zone: string
  /** Seconds until an access token expires (default 3600). */
  accessTokenTtl?: number
  pageSize?: number
}

export interface FakeTasksControl {
  lists(): GoogleTaskList[]
  defaultListId: string
  /** Every task in a list, including deleted ones. */
  all(listId: string): GoogleTask[]
  create(listId: string, t: Partial<GoogleTask>, parent?: string): GoogleTask
  edit(listId: string, id: string, patch: Partial<GoogleTask>): GoogleTask
  remove(listId: string, id: string): void
  createList(title: string): GoogleTaskList
  deleteList(id: string): void
  /** The next task insert is saved but answered with a 500 (an ambiguous failure). */
  failNextInsertAfterSaving(): void
}

export interface FakeGoogle {
  endpoints: GoogleEndpoints
  /** Simulates the browser: follows the sign-in URL as a consenting user and delivers the redirect. */
  consent(authUrl: string, choice?: 'allow' | 'deny'): Promise<void>
  /** Revokes every token (as if the user removed access, or Testing-mode tokens expired). */
  revokeAll(): void
  /** Makes the next N API calls fail with 429. */
  rateLimitNext(n: number): void
  /** Expires every current access token now. */
  expireAccessTokens(): void
  requests: { method: string; path: string }[]
  /** Calendar write calls the app made (inserts, patches, deletes). */
  calendarWrites: { method: string; calendarId: string; eventId: string }[]
  /** Live (not cancelled) events on a calendar, as Google holds them. */
  calendarEvents(calendarId: string): GoogleEvent[]
  /** All calendars, including ones the app created. */
  calendarList(): GoogleCalendarListEntry[]
  /** Google Tasks as the user's phone sees it: read and change it directly, bypassing the app. */
  tasks: FakeTasksControl
  close(): Promise<void>
}

interface Grant {
  challenge: string
  redirectUri: string
  scopes: string[]
  used: boolean
}

function toGoogle(e: CalendarEvent): GoogleEvent {
  const id = e.id.replace(/[^a-z0-9]/gi, '')
  return e.allDay
    ? { id, status: 'confirmed', summary: e.title, start: { date: e.start }, end: { date: e.end } }
    : { id, status: 'confirmed', summary: e.title, start: { dateTime: e.start }, end: { dateTime: e.end } }
}

export async function startFakeGoogle(o: FakeGoogleOptions): Promise<FakeGoogle> {
  const events = new Map<string, GoogleEvent[]>()
  for (const cal of FAKE_CALENDARS) events.set(CALENDAR_IDS[cal.id]!, [])
  for (const e of generateFakeCalendar(o.today, o.zone)) events.get(CALENDAR_IDS[e.calendarId]!)!.push(toGoogle(e))
  // A cancelled exception to the recurring standup, as Google returns it with singleEvents=true.
  events.get(CALENDAR_IDS.work!)!.push({ id: 'standup_cancelled', status: 'cancelled', recurringEventId: 'standup' })

  const calendars: GoogleCalendarListEntry[] = FAKE_CALENDARS.map((c, i) => ({
    id: CALENDAR_IDS[c.id]!,
    summary: c.name,
    backgroundColor: c.color,
    accessRole: i === 0 ? 'owner' : 'reader',
    ...(i === 0 ? { primary: true } : {}),
    selected: c.id !== 'family', // one calendar hidden in Google's own UI, to test the default selection
  }))
  calendars.push({ id: 'busy@example.com', summary: 'Colleague (free/busy)', accessRole: 'freeBusyReader' })

  const grants = new Map<string, Grant>()
  const appCreated = new Set<string>()
  const writes: { method: string; calendarId: string; eventId: string }[] = []
  const refresh = new Map<string, { scopes: string[]; revoked: boolean }>()
  const access = new Map<string, { scopes: string[]; expiresAt: number }>()
  let rateLimit = 0
  const requests: { method: string; path: string }[] = []
  const ttl = o.accessTokenTtl ?? 3600
  const pageSize = o.pageSize ?? 250

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const readBody = (req: http.IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = ''
      req.on('data', (c: Buffer) => (data += c.toString()))
      req.on('end', () => resolve(data))
    })

  function page<T>(items: T[], url: URL): { items: T[]; nextPageToken?: string } {
    const max = Math.min(Number(url.searchParams.get('maxResults') ?? pageSize), pageSize)
    const start = Number(url.searchParams.get('pageToken') ?? 0)
    const slice = items.slice(start, start + max)
    return start + max < items.length ? { items: slice, nextPageToken: String(start + max) } : { items: slice }
  }

  function authorize(req: http.IncomingMessage, res: http.ServerResponse, scope: string | string[]): boolean {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    const t = token ? access.get(token) : undefined
    if (!t || t.expiresAt < Date.now()) {
      json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } })
      return false
    }
    if (!(Array.isArray(scope) ? scope : [scope]).some((s) => t.scopes.includes(s))) {
      json(res, 403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } })
      return false
    }
    return true
  }

  // --- Google Tasks state ---
  const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'
  const taskLists = new Map<string, { list: GoogleTaskList; tasks: Map<string, GoogleTask> }>()
  let ambiguousInsert = false
  let tick = 0
  // Strictly increasing timestamps, so two changes in the same millisecond still order.
  const stamp = () => new Date(Date.now() + tick++).toISOString()
  const newList = (title: string, id = `list-${randomUUID().slice(0, 8)}`) => {
    const list = { id, title, updated: stamp() }
    taskLists.set(id, { list, tasks: new Map() })
    return list
  }
  const defaultList = newList('My Tasks', 'default-list')
  const writeTask = (listId: string, t: Partial<GoogleTask> & { due?: string | null }, existing?: GoogleTask, parent?: string): GoogleTask => {
    const due = t.due === null ? undefined : t.due !== undefined ? `${t.due.slice(0, 10)}T00:00:00.000Z` : existing?.due // the time is discarded, as in Google
    const status = t.status ?? existing?.status ?? 'needsAction'
    const out: GoogleTask = {
      ...existing,
      ...t,
      id: existing?.id ?? `task-${randomUUID().slice(0, 8)}`,
      title: t.title ?? existing?.title ?? '',
      status,
      updated: stamp(),
      etag: `"${randomUUID().slice(0, 6)}"`,
    }
    if (due === undefined) delete out.due
    else out.due = due
    if (status === 'completed') out.completed = existing?.completed ?? out.updated
    else delete out.completed
    if (parent) out.parent = parent
    taskLists.get(listId)!.tasks.set(out.id, out)
    return out
  }

  const issueAccess = (scopes: string[]) => {
    const token = `at-${randomUUID()}`
    access.set(token, { scopes, expiresAt: Date.now() + ttl * 1000 })
    return token
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    requests.push({ method: req.method ?? 'GET', path: url.pathname })

    // --- OAuth ---
    if (url.pathname === '/auth') {
      const p = url.searchParams
      const redirect = new URL(p.get('redirect_uri') ?? '')
      if (p.get('client_id') !== FAKE_CLIENT.clientId || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
        json(res, 400, { error: 'invalid_request' })
        return
      }
      if (url.searchParams.get('fake_choice') === 'deny') {
        redirect.search = new URLSearchParams({ error: 'access_denied', state: p.get('state') ?? '' }).toString()
      } else {
        const code = `code-${randomUUID()}`
        grants.set(code, { challenge: p.get('code_challenge')!, redirectUri: p.get('redirect_uri')!, scopes: (p.get('scope') ?? '').split(' '), used: false })
        redirect.search = new URLSearchParams({ code, state: p.get('state') ?? '' }).toString()
      }
      res.writeHead(302, { Location: redirect.toString() }).end()
      return
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const body = new URLSearchParams(await readBody(req))
      if (body.get('client_id') !== FAKE_CLIENT.clientId || body.get('client_secret') !== FAKE_CLIENT.clientSecret) {
        json(res, 401, { error: 'invalid_client' })
        return
      }
      if (body.get('grant_type') === 'authorization_code') {
        const grant = grants.get(body.get('code') ?? '')
        const verifier = body.get('code_verifier') ?? ''
        const expected = createHash('sha256').update(verifier).digest('base64url')
        if (!grant || grant.used || grant.redirectUri !== body.get('redirect_uri') || grant.challenge !== expected) {
          json(res, 400, { error: 'invalid_grant', error_description: 'Bad code or PKCE verifier.' })
          return
        }
        grant.used = true
        const rt = `rt-${randomUUID()}`
        refresh.set(rt, { scopes: grant.scopes, revoked: false })
        json(res, 200, { access_token: issueAccess(grant.scopes), expires_in: ttl, refresh_token: rt, scope: grant.scopes.join(' '), token_type: 'Bearer' })
        return
      }
      if (body.get('grant_type') === 'refresh_token') {
        const r = refresh.get(body.get('refresh_token') ?? '')
        if (!r || r.revoked) {
          json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
          return
        }
        json(res, 200, { access_token: issueAccess(r.scopes), expires_in: ttl, scope: r.scopes.join(' '), token_type: 'Bearer' })
        return
      }
      json(res, 400, { error: 'unsupported_grant_type' })
      return
    }
    if (url.pathname === '/revoke') {
      const token = url.searchParams.get('token') ?? ''
      const r = refresh.get(token)
      if (r) r.revoked = true
      access.delete(token)
      res.writeHead(r || access.has(token) ? 200 : 400).end()
      return
    }

    // --- Google Tasks API ---
    if (url.pathname.startsWith('/tasks/v1/')) {
      if (!authorize(req, res, TASKS_SCOPE)) return
      const path = decodeURIComponent(url.pathname)
      if (path === '/tasks/v1/users/@me/lists' && req.method === 'GET') {
        json(res, 200, { kind: 'tasks#taskLists', ...page([...taskLists.values()].map((l) => l.list), url) })
        return
      }
      if (path === '/tasks/v1/users/@me/lists/@default') {
        json(res, 200, defaultList)
        return
      }
      if (path === '/tasks/v1/users/@me/lists' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { title?: string }
        json(res, 200, newList(body.title ?? 'Untitled'))
        return
      }
      const m = /^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?(\/move)?$/.exec(path)
      const entry = m ? taskLists.get(m[1]!) : undefined
      if (!m || !entry) {
        json(res, 404, { error: { code: 404, message: 'Not Found' } })
        return
      }
      const [, listId, taskId, move] = m
      if (!taskId && req.method === 'GET') {
        const min = url.searchParams.get('updatedMin')
        const showDeleted = url.searchParams.get('showDeleted') === 'true'
        const showHidden = url.searchParams.get('showHidden') === 'true'
        const showCompleted = url.searchParams.get('showCompleted') !== 'false'
        const items = [...entry.tasks.values()]
          .filter((t) => (min ? (t.updated ?? '') >= min : true))
          .filter((t) => showDeleted || !t.deleted)
          .filter((t) => showHidden || !t.hidden)
          .filter((t) => showCompleted || t.status !== 'completed')
          .sort((a, b) => (a.updated ?? '').localeCompare(b.updated ?? ''))
        json(res, 200, { kind: 'tasks#tasks', ...page(items, url) })
        return
      }
      if (!taskId && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as Partial<GoogleTask>
        const created = writeTask(listId!, body, undefined, url.searchParams.get('parent') ?? undefined)
        if (ambiguousInsert) {
          ambiguousInsert = false
          json(res, 500, { error: { code: 500, message: 'Backend Error' } })
          return
        }
        json(res, 200, created)
        return
      }
      const existing = taskId ? entry.tasks.get(taskId) : undefined
      if (!existing || existing.deleted) {
        json(res, 404, { error: { code: 404, message: 'Task not found' } })
        return
      }
      if (move && req.method === 'POST') {
        const dest = taskLists.get(url.searchParams.get('destinationTasklist') ?? '')
        if (!dest) {
          json(res, 400, { error: { code: 400, message: 'Bad destination' } })
          return
        }
        entry.tasks.delete(existing.id)
        const moved = { ...existing, updated: stamp() }
        delete moved.parent
        dest.tasks.set(moved.id, moved)
        json(res, 200, moved)
        return
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse(await readBody(req)) as Partial<GoogleTask> & { due?: string | null }
        json(res, 200, writeTask(listId!, body, existing))
        return
      }
      if (req.method === 'DELETE') {
        entry.tasks.set(existing.id, { ...existing, deleted: true, updated: stamp() })
        res.writeHead(204).end()
        return
      }
      json(res, 405, { error: { code: 405, message: 'Method not allowed' } })
      return
    }

    // --- Calendar API ---
    if (rateLimit > 0 && url.pathname.startsWith('/calendar/')) {
      rateLimit--
      json(res, 429, { error: { code: 429, message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } })
      return
    }
    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      if (!authorize(req, res, 'https://www.googleapis.com/auth/calendar.calendarlist.readonly')) return
      json(res, 200, { kind: 'calendar#calendarList', ...page(calendars, url) })
      return
    }
    // --- Calendar writes (M9) ---
    const S = (x: string) => `https://www.googleapis.com/auth/${x}`
    if (url.pathname === '/calendar/v3/calendars' && req.method === 'POST') {
      // Creating a secondary calendar needs calendar.app.created (or full calendar access).
      if (!authorize(req, res, [S('calendar.app.created'), S('calendar')])) return
      const body = JSON.parse(await readBody(req)) as { summary?: string; timeZone?: string }
      const id = `mm-${randomUUID().slice(0, 8)}@group.calendar.google.com`
      calendars.push({ id, summary: body.summary ?? 'Untitled', accessRole: 'owner', selected: true, backgroundColor: '#d9622b' })
      events.set(id, [])
      appCreated.add(id)
      json(res, 200, { id, summary: body.summary, timeZone: body.timeZone })
      return
    }
    const w = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname)
    if (w && (req.method !== 'GET' || w[2])) {
      const calendarId = decodeURIComponent(w[1]!)
      const list = events.get(calendarId)
      const cal = calendars.find((c) => c.id === calendarId)
      if (!list || !cal) {
        json(res, 404, { error: { code: 404, message: 'Not Found' } })
        return
      }
      // Writing needs events.owned on calendars you own, or app.created on calendars this app made.
      const writeScopes = appCreated.has(calendarId) ? [S('calendar.app.created'), S('calendar.events.owned'), S('calendar.events'), S('calendar')] : [S('calendar.events.owned'), S('calendar.events'), S('calendar')]
      const readScopes = [...writeScopes, S('calendar.events.readonly')]
      if (!authorize(req, res, req.method === 'GET' ? readScopes : writeScopes)) return
      if (req.method !== 'GET' && cal.accessRole !== 'owner') {
        json(res, 403, { error: { code: 403, message: 'Forbidden', errors: [{ reason: 'requiredAccessLevel' }] } })
        return
      }
      const eventId = w[2] ? decodeURIComponent(w[2]) : undefined
      if (!eventId && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as GoogleEvent & Record<string, unknown>
        const id = body.id ?? `ev${randomUUID().replace(/-/g, '')}`
        if (!/^[a-v0-9]{5,1024}$/.test(id)) {
          json(res, 400, { error: { code: 400, message: 'Invalid resource id value.' } })
          return
        }
        if (list.some((e) => e.id === id)) {
          json(res, 409, { error: { code: 409, message: 'The requested identifier already exists.', errors: [{ reason: 'duplicate' }] } })
          return
        }
        const created = { ...body, id, status: 'confirmed' as const }
        list.push(created)
        writes.push({ method: 'POST', calendarId, eventId: id })
        json(res, 200, created)
        return
      }
      const i = list.findIndex((e) => e.id === eventId && e.status !== 'cancelled')
      if (i < 0) {
        json(res, req.method === 'DELETE' ? 410 : 404, { error: { code: req.method === 'DELETE' ? 410 : 404, message: req.method === 'DELETE' ? 'Resource has been deleted' : 'Not Found' } })
        return
      }
      if (req.method === 'GET') {
        json(res, 200, list[i])
        return
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse(await readBody(req)) as Partial<GoogleEvent>
        list[i] = { ...list[i]!, ...body, id: list[i]!.id }
        writes.push({ method: 'PATCH', calendarId, eventId: list[i]!.id })
        json(res, 200, list[i])
        return
      }
      if (req.method === 'DELETE') {
        list[i] = { ...list[i]!, status: 'cancelled' }
        writes.push({ method: 'DELETE', calendarId, eventId: list[i]!.id })
        res.writeHead(204).end()
        return
      }
    }

    const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname)
    if (m) {
      if (!authorize(req, res, [S('calendar.events.readonly'), S('calendar.events.owned'), S('calendar.events'), S('calendar.app.created')])) return
      const calendarId = decodeURIComponent(m[1]!)
      const list = events.get(calendarId)
      if (!list) {
        json(res, 404, { error: { code: 404, message: 'Not Found' } })
        return
      }
      if (url.searchParams.get('singleEvents') !== 'true') {
        json(res, 400, { error: { code: 400, message: 'This fake only supports singleEvents=true.' } })
        return
      }
      const min = Date.parse(url.searchParams.get('timeMin') ?? '1970-01-01T00:00:00Z')
      const max = Date.parse(url.searchParams.get('timeMax') ?? '2999-01-01T00:00:00Z')
      const startOf = (e: GoogleEvent) => Date.parse(e.start?.dateTime ?? `${e.start?.date ?? '1970-01-01'}T00:00:00Z`)
      const endOf = (e: GoogleEvent) => Date.parse(e.end?.dateTime ?? `${e.end?.date ?? '2999-01-01'}T00:00:00Z`)
      const inWindow = list.filter((e) => e.status === 'cancelled' || (startOf(e) < max && endOf(e) > min))
      json(res, 200, { kind: 'calendar#events', ...page(inWindow, url) })
      return
    }
    json(res, 404, { error: { code: 404, message: `No fake for ${url.pathname}` } })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    endpoints: { auth: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke`, api: base },
    async consent(authUrl, choice = 'allow') {
      const u = new URL(authUrl)
      if (choice === 'deny') u.searchParams.set('fake_choice', 'deny')
      const r = await fetch(u, { redirect: 'manual' })
      const location = r.headers.get('location')
      if (!location) throw new Error(`fake consent failed: ${r.status}`)
      await fetch(location) // the browser following the redirect to the loopback server
    },
    revokeAll() {
      for (const r of refresh.values()) r.revoked = true
      access.clear()
    },
    calendarWrites: writes,
    calendarEvents: (id) => (events.get(id) ?? []).filter((e) => e.status !== 'cancelled'),
    calendarList: () => calendars,
    tasks: {
      lists: () => [...taskLists.values()].map((l) => l.list),
      defaultListId: defaultList.id,
      all: (listId) => [...(taskLists.get(listId)?.tasks.values() ?? [])],
      create: (listId, t, parent) => writeTask(listId, t, undefined, parent),
      edit: (listId, id, patch) => writeTask(listId, patch, taskLists.get(listId)!.tasks.get(id)),
      remove: (listId, id) => {
        const e = taskLists.get(listId)!
        const t = e.tasks.get(id)!
        e.tasks.set(id, { ...t, deleted: true, updated: stamp() })
      },
      createList: (title) => newList(title),
      deleteList: (id) => void taskLists.delete(id),
      failNextInsertAfterSaving: () => {
        ambiguousInsert = true
      },
    },
    rateLimitNext(n) {
      rateLimit = n
    },
    expireAccessTokens() {
      for (const t of access.values()) t.expiresAt = 0
    },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
