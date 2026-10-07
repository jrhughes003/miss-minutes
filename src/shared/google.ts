// What the UI sees of the Google connection. No secrets ever appear here.

export interface CalendarSummary {
  id: string
  summary: string
  color: string | null
  primary: boolean
  selected: boolean
  readable: boolean
}

export interface GoogleStatus {
  /** False in the web demo: Google is desktop-only. */
  available: boolean
  clientConfigured: boolean
  connected: boolean
  /** The stored grant stopped working (revoked, or Testing-mode expiry); the user must reconnect. */
  needsReconnect: boolean
  syncing: boolean
  lastSync: string | null
  lastError: string | null
  calendars: CalendarSummary[]
}

export const UNAVAILABLE_GOOGLE: GoogleStatus = {
  available: false,
  clientConfigured: false,
  connected: false,
  needsReconnect: false,
  syncing: false,
  lastSync: null,
  lastError: null,
  calendars: [],
}
