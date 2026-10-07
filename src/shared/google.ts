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
  tasks: TasksSyncStatus
  phone: PhoneRemindersStatus
  blocks: CalendarBlocksStatus
}

export interface CalendarBlocksStatus {
  /** The grant includes calendar.events.owned. */
  scopeGranted: boolean
  /** Calendars the user owns, where plan blocks can go (primary first). */
  calendars: { id: string; summary: string; primary: boolean }[]
}

export interface PhoneRemindersStatus {
  enabled: boolean
  /** The grant includes calendar.app.created (a one-time re-consent). */
  scopeGranted: boolean
  /** Ready to use: on, permitted, and connected. */
  active: boolean
}

export interface TasksSyncLogEntry {
  at: string
  kind: string
  title: string
  detail: string
}

export interface TasksSyncStatus {
  /** The user's choice in Settings. */
  enabled: boolean
  /** Whether the Google grant includes Tasks access (needs a one-time re-consent). */
  scopeGranted: boolean
  lastSync: string | null
  log: TasksSyncLogEntry[]
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
  tasks: { enabled: false, scopeGranted: false, lastSync: null, log: [] },
  phone: { enabled: false, scopeGranted: false, active: false },
  blocks: { scopeGranted: false, calendars: [] },
}
