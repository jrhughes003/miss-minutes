// Holds the Google connection: the imported OAuth client, the tokens, and a
// valid access token on demand.

import { startLoopback } from './loopback'
import {
  buildAuthUrl,
  createPkce,
  createState,
  exchangeCode,
  NeedsReconnectError,
  parseCallback,
  parseClientFile,
  refreshTokens,
  revokeToken,
  type GoogleEndpoints,
  type OAuthClient,
  type Tokens,
} from './oauth'
import type { SecretStore } from './secrets'

const CLIENT = 'google.client'
const TOKENS = 'google.tokens'
/** Refresh a little before expiry, so a request never races the deadline. */
const REFRESH_MARGIN_MS = 60_000

export interface GoogleAuthOptions {
  fetch: typeof fetch
  endpoints: GoogleEndpoints
  secrets: SecretStore
  /** Opens the sign-in page in the user's browser. */
  openBrowser: (url: string) => Promise<void> | void
  now?: () => number
  loopbackTimeoutMs?: number
}

export interface AuthStatus {
  clientConfigured: boolean
  connected: boolean
  scopes: string[]
}

export class GoogleAuth {
  private refreshing: Promise<Tokens> | null = null
  private readonly now: () => number

  constructor(private readonly o: GoogleAuthOptions) {
    this.now = o.now ?? Date.now
  }

  status(): AuthStatus {
    const tokens = this.tokens()
    return { clientConfigured: this.client() !== null, connected: tokens !== null, scopes: tokens?.scopes ?? [] }
  }

  /** Validates and stores (encrypted) the client JSON from Google Cloud Console. */
  importClient(json: string): void {
    const client = parseClientFile(json)
    this.o.secrets.set(CLIENT, JSON.stringify(client))
  }

  /** Runs the sign-in flow: browser → loopback redirect → token exchange. */
  async connect(scopes: readonly string[]): Promise<void> {
    const client = this.client()
    if (!client) throw new Error('Import your Google OAuth client file first.')
    const { verifier, challenge } = createPkce()
    const state = createState()
    const loopback = await startLoopback(this.o.loopbackTimeoutMs)
    try {
      const url = buildAuthUrl({ endpoints: this.o.endpoints, clientId: client.clientId, redirectUri: loopback.redirectUri, scopes, challenge, state })
      await this.o.openBrowser(url)
      const { code } = parseCallback(await loopback.result, state)
      const tokens = await exchangeCode(this.o.fetch, this.o.endpoints, client, { code, verifier, redirectUri: loopback.redirectUri, now: this.now() })
      this.o.secrets.set(TOKENS, JSON.stringify(tokens))
    } finally {
      loopback.close()
    }
  }

  /**
   * A valid access token, refreshing it if needed. Concurrent callers share
   * one refresh. If Google says the grant is gone, the stored tokens are
   * deleted and NeedsReconnectError is thrown.
   */
  async accessToken(): Promise<string> {
    const tokens = this.tokens()
    if (!tokens) throw new NeedsReconnectError('Google Calendar is not connected.')
    if (tokens.expiresAt - this.now() > REFRESH_MARGIN_MS) return tokens.accessToken
    const client = this.client()
    if (!client) throw new NeedsReconnectError('The Google OAuth client is missing. Import it again in Settings.')

    this.refreshing ??= refreshTokens(this.o.fetch, this.o.endpoints, client, tokens, this.now())
      .then((fresh) => {
        this.o.secrets.set(TOKENS, JSON.stringify(fresh))
        return fresh
      })
      .catch((e: unknown) => {
        if (e instanceof NeedsReconnectError) this.o.secrets.delete(TOKENS)
        throw e
      })
      .finally(() => {
        this.refreshing = null
      })
    return (await this.refreshing).accessToken
  }

  /** Called after a 401: the next accessToken() call refreshes. */
  invalidateAccessToken(): void {
    const tokens = this.tokens()
    if (tokens) this.o.secrets.set(TOKENS, JSON.stringify({ ...tokens, expiresAt: 0 }))
  }

  /** Revokes the grant at Google (best effort) and forgets the tokens. */
  async disconnect(): Promise<void> {
    const tokens = this.tokens()
    this.o.secrets.delete(TOKENS)
    if (tokens) await revokeToken(this.o.fetch, this.o.endpoints, tokens.refreshToken)
  }

  private client(): OAuthClient | null {
    const raw = this.o.secrets.get(CLIENT)
    return raw ? (JSON.parse(raw) as OAuthClient) : null
  }

  private tokens(): Tokens | null {
    const raw = this.o.secrets.get(TOKENS)
    return raw ? (JSON.parse(raw) as Tokens) : null
  }
}
