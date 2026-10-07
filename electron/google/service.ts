// The Google connection as the rest of the app sees it: status, connect,
// disconnect, calendar choice, and background syncing.

import type { Clock } from '../../src/core/clock'
import type { CalendarEvent } from '../../src/core/today'
import type { GoogleStatus } from '../../src/shared/google'
import { GoogleApi } from './api'
import { GoogleAuth } from './auth'
import type { CalendarStore } from './calendarStore'
import { syncCalendars } from './calendarSync'
import { CALENDAR_READ_SCOPES, NeedsReconnectError, type GoogleEndpoints } from './oauth'
import type { SecretStore } from './secrets'

export interface GoogleServiceOptions {
  fetch: typeof fetch
  endpoints: GoogleEndpoints
  secrets: SecretStore
  store: CalendarStore
  clock: Clock
  openBrowser: (url: string) => Promise<void> | void
  /** Called when the status or cached events change. */
  onChange: () => void
}

export class GoogleService {
  readonly auth: GoogleAuth
  private readonly api: GoogleApi
  private syncing: Promise<void> | null = null
  private lastSync: string | null = null
  private lastError: string | null = null
  private needsReconnect = false

  constructor(private readonly o: GoogleServiceOptions) {
    this.auth = new GoogleAuth({ fetch: o.fetch, endpoints: o.endpoints, secrets: o.secrets, openBrowser: o.openBrowser, now: () => o.clock.now().getTime() })
    this.api = new GoogleApi({ fetch: o.fetch, endpoints: o.endpoints, auth: this.auth })
    this.lastSync = o.secrets.get('google.lastSync')
  }

  status(): GoogleStatus {
    const auth = this.auth.status()
    return {
      available: true,
      clientConfigured: auth.clientConfigured,
      connected: auth.connected,
      needsReconnect: this.needsReconnect && !auth.connected,
      syncing: this.syncing !== null,
      lastSync: this.lastSync,
      lastError: this.lastError,
      calendars: auth.connected ? this.o.store.calendars().map(({ accessRole: _a, ...c }) => c) : [],
    }
  }

  importClient(json: string): GoogleStatus {
    this.auth.importClient(json)
    this.o.onChange()
    return this.status()
  }

  async connect(): Promise<GoogleStatus> {
    await this.auth.connect(CALENDAR_READ_SCOPES)
    this.needsReconnect = false
    this.lastError = null
    this.o.onChange()
    await this.sync()
    return this.status()
  }

  async disconnect(): Promise<GoogleStatus> {
    await this.auth.disconnect()
    this.o.store.clear() // nothing from Google is kept after disconnecting
    this.lastSync = null
    this.o.secrets.delete('google.lastSync')
    this.lastError = null
    this.needsReconnect = false
    this.o.onChange()
    return this.status()
  }

  async setCalendar(id: string, selected: boolean): Promise<GoogleStatus> {
    this.o.store.setSelected(id, selected)
    this.o.onChange()
    if (selected) await this.sync()
    return this.status()
  }

  events(from: string, to: string): CalendarEvent[] {
    return this.auth.status().connected ? this.o.store.eventsBetween(from, to, this.o.clock.zone()) : []
  }

  /** Syncs now; concurrent calls share one run. Errors are recorded in the status, not thrown. */
  sync(): Promise<void> {
    if (!this.auth.status().connected) return Promise.resolve()
    this.syncing ??= (async () => {
      this.o.onChange()
      try {
        await syncCalendars(this.api, this.o.store, this.o.clock.now(), this.o.clock.zone())
        this.lastSync = this.o.clock.now().toISOString()
        this.o.secrets.set('google.lastSync', this.lastSync)
        this.lastError = null
      } catch (e) {
        if (e instanceof NeedsReconnectError) this.needsReconnect = true
        this.lastError = (e as Error).message
      } finally {
        this.syncing = null
        this.o.onChange()
      }
    })()
    return this.syncing
  }
}
