// Google OAuth for an installed (desktop) app: loopback redirect + PKCE (D9).
//
// The flow, and why each piece exists:
// 1. Make a random secret, the PKCE *code verifier*, and send only its SHA-256
//    hash (the *code challenge*) with the sign-in request.
// 2. The user signs in in their normal browser. Google redirects to
//    http://127.0.0.1:<port>/ on this machine with a one-time *code*.
// 3. The app exchanges code + verifier for tokens. Google checks that
//    SHA-256(verifier) matches the challenge from step 1.
//
// A desktop app's "client secret" ships inside the installer, so it isn't
// secret; anyone could unpack it. PKCE is what stops a stolen code being
// used: without the verifier, which never left this process, the code is
// worthless. The random `state` value ties the redirect to the request we
// made, so another page can't inject its own code (login CSRF).
//
// Endpoints come from GoogleEndpoints so tests can point everything at a
// local fake server. Nothing in this file talks to Google by itself.

import { createHash, randomBytes } from 'node:crypto'

export interface GoogleEndpoints {
  auth: string
  token: string
  revoke: string
  /** Base URL for the REST APIs (Calendar, Tasks). */
  api: string
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com',
}

/** M5 asks only for read access (D10). Write scopes are requested separately at M9. */
export const CALENDAR_READ_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
] as const

/** Two-way Google Tasks sync (M8, D10). Requested only once the user turns Tasks sync on. */
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'

/**
 * Phone reminders (M9): lets the app create its own "Miss Minutes" calendar
 * and manage events on that calendar only. It grants nothing on the user's
 * other calendars (D10, D37).
 */
export const APP_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'

export interface OAuthClient {
  clientId: string
  clientSecret: string
}

export interface Tokens {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  refreshToken: string
  scopes: string[]
}

/** The stored grant is no longer valid (revoked, or expired after 7 days in Testing). The user must reconnect. */
export class NeedsReconnectError extends Error {
  constructor(message = 'Google access has expired or was revoked. Reconnect your Google account in Settings.') {
    super(message)
    this.name = 'NeedsReconnectError'
  }
}

const base64url = (b: Buffer) => b.toString('base64url')

/** A fresh PKCE pair. 32 random bytes give a 43-character verifier, the minimum RFC 7636 allows. */
export function createPkce(random: (n: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = base64url(random(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function createState(random: (n: number) => Buffer = randomBytes): string {
  return base64url(random(16))
}

export function buildAuthUrl(o: { endpoints: GoogleEndpoints; clientId: string; redirectUri: string; scopes: readonly string[]; challenge: string; state: string }): string {
  const url = new URL(o.endpoints.auth)
  url.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: o.scopes.join(' '),
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    // A refresh token, so the app keeps working without signing in each hour.
    access_type: 'offline',
    // Always show consent, so Google always returns a refresh token.
    prompt: 'consent',
    include_granted_scopes: 'true',
  }).toString()
  return url.toString()
}

/** Reads the redirect Google sent to the loopback server. */
export function parseCallback(url: URL, expectedState: string): { code: string } {
  const error = url.searchParams.get('error')
  if (error) throw new Error(error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed: ${error}`)
  if (url.searchParams.get('state') !== expectedState) throw new Error('Google sign-in failed: the response did not match this request (state mismatch).')
  const code = url.searchParams.get('code')
  if (!code) throw new Error('Google sign-in failed: no authorization code returned.')
  return { code }
}

/**
 * Validates the JSON file downloaded from Google Cloud Console. It must be a
 * "Desktop app" client (`installed`), the only type allowed to use a loopback
 * redirect.
 */
export function parseClientFile(json: string): OAuthClient {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('That file is not valid JSON. Download the client file again from Google Cloud Console.')
  }
  const installed = (data as { installed?: { client_id?: unknown; client_secret?: unknown } }).installed
  if (!installed) {
    if ((data as { web?: unknown }).web) throw new Error('This is a "Web application" client. Create a "Desktop app" OAuth client instead.')
    throw new Error('This does not look like a Google OAuth client file (no "installed" section).')
  }
  const { client_id, client_secret } = installed
  if (typeof client_id !== 'string' || !client_id.endsWith('.apps.googleusercontent.com') || typeof client_secret !== 'string' || !client_secret) {
    throw new Error('The client file is missing its client ID or secret.')
  }
  return { clientId: client_id, clientSecret: client_secret }
}

type Fetch = typeof fetch

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  error?: string
  error_description?: string
}

async function postToken(fetchFn: Fetch, endpoints: GoogleEndpoints, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchFn(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const data = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || data.error) {
    // invalid_grant: the code was used/expired, or the refresh token was revoked
    // or expired (the 7-day Testing-mode limit ends this way).
    if (data.error === 'invalid_grant') throw new NeedsReconnectError()
    throw new Error(`Google token request failed (${res.status}): ${data.error_description ?? data.error ?? 'unknown error'}`)
  }
  if (!data.access_token || typeof data.expires_in !== 'number') throw new Error('Google returned an incomplete token response.')
  return data
}

export async function exchangeCode(
  fetchFn: Fetch,
  endpoints: GoogleEndpoints,
  client: OAuthClient,
  o: { code: string; verifier: string; redirectUri: string; now: number },
): Promise<Tokens> {
  const data = await postToken(fetchFn, endpoints, {
    grant_type: 'authorization_code',
    code: o.code,
    code_verifier: o.verifier,
    redirect_uri: o.redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  })
  if (!data.refresh_token) throw new Error('Google did not return a refresh token. Remove Miss Minutes at myaccount.google.com/permissions and connect again.')
  return { accessToken: data.access_token!, expiresAt: o.now + data.expires_in! * 1000, refreshToken: data.refresh_token, scopes: (data.scope ?? '').split(' ').filter(Boolean) }
}

export async function refreshTokens(fetchFn: Fetch, endpoints: GoogleEndpoints, client: OAuthClient, current: Tokens, now: number): Promise<Tokens> {
  const data = await postToken(fetchFn, endpoints, {
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  })
  return {
    accessToken: data.access_token!,
    expiresAt: now + data.expires_in! * 1000,
    // Google usually doesn't send a new refresh token on refresh; keep the old one.
    refreshToken: data.refresh_token ?? current.refreshToken,
    scopes: data.scope ? data.scope.split(' ').filter(Boolean) : current.scopes,
  }
}

/** Best effort: revoking a token Google already forgot is not an error. */
export async function revokeToken(fetchFn: Fetch, endpoints: GoogleEndpoints, token: string): Promise<void> {
  try {
    await fetchFn(`${endpoints.revoke}?${new URLSearchParams({ token })}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  } catch {
    /* offline: the local tokens are deleted anyway */
  }
}
