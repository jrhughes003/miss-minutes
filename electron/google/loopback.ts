// The loopback listener for the OAuth redirect (D9).
//
// Listens on 127.0.0.1 only (never on the network), on a random free port the
// OS picks, for one request: Google's redirect after sign-in. It answers with
// a short "you can close this tab" page and shuts down. It gives up after a
// timeout, so an abandoned sign-in doesn't leave a port open.

import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Loopback {
  redirectUri: string
  /** Resolves with the full redirect URL, or rejects on timeout. */
  result: Promise<URL>
  close(): void
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font:16px system-ui,sans-serif;margin:15vh auto;max-width:32rem;padding:0 1rem;color:#2b2118}</style></head>` +
  `<body><h1>${title}</h1><p>${body}</p></body></html>`

export async function startLoopback(timeoutMs = 5 * 60_000): Promise<Loopback> {
  let resolve!: (u: URL) => void
  let reject!: (e: Error) => void
  const result = new Promise<URL>((res, rej) => {
    resolve = res
    reject = rej
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    // Browsers also ask for /favicon.ico; only the root path is the redirect.
    if (url.pathname !== '/' || (!url.searchParams.has('code') && !url.searchParams.has('error'))) {
      res.writeHead(404).end()
      return
    }
    const ok = url.searchParams.has('code')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(ok ? PAGE('Signed in', 'Miss Minutes is connected. You can close this tab.') : PAGE('Sign-in cancelled', 'You can close this tab and try again from Miss Minutes.'))
    // The URL is mostly built from the request, so it doesn't carry our host.
    resolve(new URL(url.pathname + url.search, redirectUri))
    close()
  })

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const { port } = server.address() as AddressInfo
  const redirectUri = `http://127.0.0.1:${port}/`

  const timer = setTimeout(() => {
    reject(new Error('Google sign-in timed out. Try again.'))
    close()
  }, timeoutMs)
  timer.unref?.()

  let closed = false
  function close() {
    if (closed) return
    closed = true
    clearTimeout(timer)
    server.close()
    server.closeAllConnections?.()
  }

  return { redirectUri, result, close }
}
