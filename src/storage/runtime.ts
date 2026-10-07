// Decides, once at startup, where data lives (the financeflow pattern):
// - inside Electron, `window.api` exists and data goes to SQLite in the main
//   process over IPC;
// - in a plain browser (the web demo, `npm run dev`), there's no bridge and data
//   lives in localStorage.
// UI code asks this module rather than checking `window.api` itself, so the
// choice is made in one place.

import type { MissMinutesApi } from '../shared/ipc'

export type StorageMode = 'sqlite' | 'localStorage'

export function detectBridge(win: { api?: MissMinutesApi } | undefined): MissMinutesApi | null {
  return win?.api?.isElectron ? win.api : null
}

export const bridge: MissMinutesApi | null = detectBridge(typeof window === 'undefined' ? undefined : window)
export const storageMode: StorageMode = bridge ? 'sqlite' : 'localStorage'
