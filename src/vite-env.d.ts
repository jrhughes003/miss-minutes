/// <reference types="vite/client" />
import type { MissMinutesApi } from './shared/ipc'

declare global {
  interface Window {
    /** Present only inside Electron, injected by electron/preload.ts. */
    api?: MissMinutesApi
  }
}
