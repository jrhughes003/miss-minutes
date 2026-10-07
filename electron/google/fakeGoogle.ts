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

  function authorize(req: http.IncomingMessage, res: http.ServerResponse, scope: string): boolean {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    const t = token ? access.get(token) : undefined
    if (!t || t.expiresAt < Date.now()) {
      json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } })
      return false
    }
    if (!t.scopes.includes(scope)) {
      json(res, 403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } })
      return false
    }
    return true
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
    const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname)
    if (m) {
      if (!authorize(req, res, 'https://www.googleapis.com/auth/calendar.events.readonly')) return
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
