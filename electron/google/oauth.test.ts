import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { startLoopback } from './loopback'
import { buildAuthUrl, createPkce, createState, GOOGLE_ENDPOINTS, parseCallback, parseClientFile } from './oauth'

describe('PKCE', () => {
  it('makes a challenge that is the base64url SHA-256 of the verifier', () => {
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/) // RFC 7636: 43–128 unreserved characters
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('never repeats', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier)
    expect(createState()).not.toBe(createState())
  })
})

describe('buildAuthUrl', () => {
  it('asks for a code with PKCE, offline access and only the requested scopes', () => {
    const url = new URL(buildAuthUrl({ endpoints: GOOGLE_ENDPOINTS, clientId: 'abc.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:5555/', scopes: ['s1', 's2'], challenge: 'CH', state: 'ST' }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'abc.apps.googleusercontent.com',
      redirect_uri: 'http://127.0.0.1:5555/',
      response_type: 'code',
      scope: 's1 s2',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
      state: 'ST',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })
  })
})

describe('parseCallback', () => {
  const at = (q: string) => new URL(`http://127.0.0.1:1/?${q}`)
  it('returns the code when the state matches', () => {
    expect(parseCallback(at('code=C&state=S'), 'S')).toEqual({ code: 'C' })
  })
  it('rejects a mismatched state (another page injecting its own code)', () => {
    expect(() => parseCallback(at('code=C&state=EVIL'), 'S')).toThrow(/state mismatch/)
  })
  it('explains a cancelled sign-in', () => {
    expect(() => parseCallback(at('error=access_denied&state=S'), 'S')).toThrow(/cancelled/)
  })
  it('rejects a callback with no code', () => {
    expect(() => parseCallback(at('state=S'), 'S')).toThrow(/no authorization code/)
  })
})

describe('parseClientFile', () => {
  const desktop = JSON.stringify({ installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-x', redirect_uris: ['http://localhost'] } })
  it('accepts a Desktop app client', () => {
    expect(parseClientFile(desktop)).toEqual({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-x' })
  })
  it('explains the common mistakes', () => {
    expect(() => parseClientFile('nope')).toThrow(/not valid JSON/)
    expect(() => parseClientFile(JSON.stringify({ web: {} }))).toThrow(/Desktop app/)
    expect(() => parseClientFile(JSON.stringify({ something: {} }))).toThrow(/installed/)
    expect(() => parseClientFile(JSON.stringify({ installed: { client_id: 'x' } }))).toThrow(/missing/)
  })
})

describe('startLoopback', () => {
  it('listens on 127.0.0.1 only, accepts the redirect once, and closes', async () => {
    const lb = await startLoopback()
    expect(lb.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect((await fetch(new URL('favicon.ico', lb.redirectUri))).status).toBe(404)
    const page = await fetch(`${lb.redirectUri}?code=abc&state=xyz`)
    expect(await page.text()).toMatch(/close this tab/)
    const url = await lb.result
    expect(url.searchParams.get('code')).toBe('abc')
    await expect(fetch(`${lb.redirectUri}?code=again`)).rejects.toThrow() // closed
  })

  it('gives up after its timeout', async () => {
    const lb = await startLoopback(50)
    await expect(lb.result).rejects.toThrow(/timed out/)
  })
})
