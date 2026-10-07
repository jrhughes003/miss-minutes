// Hardening applied to every window. Each rule closes a route by which web
// content could reach beyond the app's own page.
//
// - The CSP header limits what the page may load or connect to, and is the same
//   policy as the meta tag in the built HTML (vite.config.ts).
// - Navigation is blocked, so a link can't replace our page with a remote one
//   that would then inherit the preload bridge.
// - New windows are denied; http(s) links open in the user's browser instead.
// - Permission requests (camera, geolocation, ...) are refused. The renderer
//   needs none of them, and notifications are shown by the main process.

import { shell, type BrowserWindow, type Session } from 'electron'
import { CSP } from '../src/shared/csp'

export function applySessionSecurity(session: Session, isDev: boolean): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  if (isDev) return // Vite's hot reload needs inline scripts and a websocket.
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
    })
  })
}

export function applyWindowSecurity(win: BrowserWindow, devServerUrl: string | undefined): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const ownPage = devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
    if (!ownPage) event.preventDefault()
  })
}
