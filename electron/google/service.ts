// The Google connection as the rest of the app sees it: status, connect,
// disconnect, calendar choice, and background syncing.

import type { Clock } from '../../src/core/clock'
import type { SettingsStore } from '../../src/core/settings'
import type { LocalTime } from '../../src/core/time'
import type { SqlDatabase } from '../db/database'
import type { TaskService } from '../../src/core/tasks/service'
import type { CalendarEvent } from '../../src/core/today'
import type { GoogleStatus } from '../../src/shared/google'
import { GoogleApi } from './api'
import { GoogleAuth } from './auth'
import type { CalendarStore } from './calendarStore'
import { syncCalendars } from './calendarSync'
import { createHash } from 'node:crypto'
import type { BlockRef, BlockWriter } from '../../src/core/plan/apply'
import { GoogleApiError } from './api'
import { APP_CALENDAR_SCOPE, CALENDAR_READ_SCOPES, CALENDAR_WRITE_SCOPE, NeedsReconnectError, TASKS_SCOPE, type GoogleEndpoints } from './oauth'
import { PhoneMirror } from './phoneMirror'
import { syncTasks } from './tasksSync'
import type { TasksSyncStore } from './tasksSyncStore'
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
  settings: SettingsStore
  tasks: TaskService
  tasksStore: TasksSyncStore
  /** Called after Tasks sync changed local tasks, so the UI can refresh. */
  onTasksChanged?: () => void
  /** Delay before syncing after a local edit (ms). */
  tasksDebounceMs?: number
  db: SqlDatabase
  allDayTime: () => LocalTime
}

export class GoogleService {
  readonly auth: GoogleAuth
  private readonly api: GoogleApi
  private syncing: Promise<void> | null = null
  private lastSync: string | null = null
  private lastError: string | null = null
  private needsReconnect = false
  private tasksTimer: ReturnType<typeof setTimeout> | null = null
  private readonly phone: PhoneMirror

  constructor(private readonly o: GoogleServiceOptions) {
    this.auth = new GoogleAuth({ fetch: o.fetch, endpoints: o.endpoints, secrets: o.secrets, openBrowser: o.openBrowser, now: () => o.clock.now().getTime() })
    this.api = new GoogleApi({ fetch: o.fetch, endpoints: o.endpoints, auth: this.auth })
    this.lastSync = o.secrets.get('google.lastSync')
    this.phone = new PhoneMirror({ api: this.api, db: o.db, tasks: o.tasks, clock: o.clock, settings: o.settings, allDayTime: o.allDayTime })
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
      tasks: {
        enabled: this.tasksEnabled(),
        scopeGranted: auth.scopes.includes(TASKS_SCOPE),
        lastSync: this.o.settings.get('google.tasksLastSync'),
        log: this.o.tasksStore.recentLog(15),
      },
      blocks: {
        scopeGranted: auth.scopes.includes(CALENDAR_WRITE_SCOPE),
        calendars: auth.connected
          ? this.o.store
              .calendars()
              .filter((c) => c.accessRole === 'owner' && c.id !== this.phone.calendarId())
              .map((c) => ({ id: c.id, summary: c.summary, primary: c.primary }))
          : [],
      },
      phone: {
        enabled: this.phoneEnabled(),
        scopeGranted: auth.scopes.includes(APP_CALENDAR_SCOPE),
        active: auth.connected && this.phoneEnabled() && auth.scopes.includes(APP_CALENDAR_SCOPE),
      },
    }
  }

  /** Asks Google for permission to write plan blocks to your own calendars (one consent). */
  async allowBlocks(): Promise<GoogleStatus> {
    this.o.settings.set('google.planBlocks', 'true')
    return this.connect()
  }

  /** Writes and removes plan blocks (core/plan/apply.ts). Ids derive from the batch and item, so a retry never duplicates. */
  readonly blockWriter: BlockWriter = {
    refFor: (calendarId, batchId, key): BlockRef => ({ calendarId, eventId: `mmplan${createHash('sha256').update(`${batchId}|${key}`).digest('hex').slice(0, 40)}` }),
    write: async (calendarId, batchId, blocks) => {
      for (const b of blocks) {
        const { eventId } = this.blockWriter.refFor(calendarId, batchId, b.key)
        await this.api
          .insertEvent(calendarId, {
            id: eventId,
            summary: b.title,
            description: 'Planned in Miss Minutes.',
            start: { dateTime: b.start, timeZone: this.o.clock.zone() },
            end: { dateTime: b.end, timeZone: this.o.clock.zone() },
            transparency: 'opaque',
            reminders: { useDefault: false, overrides: [] },
            extendedProperties: { private: { mmTask: b.taskId, mmBatch: batchId } },
          })
          .catch((e: unknown) => {
            if (!(e instanceof GoogleApiError && e.status === 409)) throw e // 409: already written on an earlier try
          })
      }
      void this.sync() // show the new blocks as busy straight away
    },
    remove: async (refs) => {
      for (const r of refs) {
        await this.api.deleteEvent(r.calendarId, r.eventId).catch((e: unknown) => {
          if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e
        })
      }
      void this.sync()
    },
  }

  private phoneEnabled(): boolean {
    return this.o.settings.get('google.phoneReminders') === 'true'
  }

  /**
   * Turns phone reminders on or off. On needs calendar.app.created, which the
   * next Connect asks for. Off removes every event this app put on its
   * calendar.
   */
  async setPhoneReminders(enabled: boolean): Promise<GoogleStatus> {
    this.o.settings.set('google.phoneReminders', String(enabled))
    if (!enabled && this.auth.status().connected) await this.phone.removeAll().catch(() => {})
    this.o.onChange()
    if (enabled) await this.sync()
    return this.status()
  }

  private tasksEnabled(): boolean {
    return this.o.settings.get('google.tasksSync') === 'true'
  }

  /**
   * Turns two-way Tasks sync on or off. Turning it off forgets the sync
   * mapping but keeps every task on both sides. Turning it on needs Tasks
   * access, which the next Connect asks for.
   */
  async setTasksSync(enabled: boolean): Promise<GoogleStatus> {
    this.o.settings.set('google.tasksSync', String(enabled))
    if (!enabled) this.o.tasksStore.reset()
    this.o.onChange()
    if (enabled) await this.sync()
    return this.status()
  }

  /** After a local task edit: sync soon, once, rather than on every keystroke. */
  scheduleTasksSync(): void {
    const scopes = this.auth.status().scopes
    const tasksOn = this.tasksEnabled() && scopes.includes(TASKS_SCOPE)
    const phoneOn = this.phoneEnabled() && scopes.includes(APP_CALENDAR_SCOPE)
    if (!tasksOn && !phoneOn) return
    if (this.tasksTimer) clearTimeout(this.tasksTimer)
    this.tasksTimer = setTimeout(() => {
      this.tasksTimer = null
      void this.sync()
    }, this.o.tasksDebounceMs ?? 10_000)
  }

  importClient(json: string): GoogleStatus {
    this.auth.importClient(json)
    this.o.onChange()
    return this.status()
  }

  async connect(): Promise<GoogleStatus> {
    // Ask only for what's in use: Tasks access only once Tasks sync is on (D10).
    await this.auth.connect([
      ...CALENDAR_READ_SCOPES,
      ...(this.tasksEnabled() ? [TASKS_SCOPE] : []),
      ...(this.phoneEnabled() ? [APP_CALENDAR_SCOPE] : []),
      ...(this.o.settings.get('google.planBlocks') === 'true' ? [CALENDAR_WRITE_SCOPE] : []),
    ])
    this.needsReconnect = false
    this.lastError = null
    this.o.onChange()
    await this.sync()
    return this.status()
  }

  async disconnect(): Promise<GoogleStatus> {
    await this.phone.removeAll().catch(() => {}) // tidy the phone calendar while access remains
    await this.auth.disconnect()
    this.o.store.clear() // nothing from Google is kept after disconnecting
    this.o.tasksStore.reset()
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
        const phoneCalendar = this.phone.calendarId()
        await syncCalendars(this.api, this.o.store, this.o.clock.now(), this.o.clock.zone(), phoneCalendar ? [phoneCalendar] : [])
        this.lastSync = this.o.clock.now().toISOString()
        this.o.secrets.set('google.lastSync', this.lastSync)
        if (this.tasksEnabled() && this.auth.status().scopes.includes(TASKS_SCOPE)) {
          const r = await syncTasks(this.api, this.o.tasksStore, this.o.tasks, this.o.clock)
          this.o.settings.set('google.tasksLastSync', this.o.clock.now().toISOString())
          if (r.pulled + r.updated + r.deleted > 0) this.o.onTasksChanged?.()
        }
        if (this.phoneEnabled() && this.auth.status().scopes.includes(APP_CALENDAR_SCOPE)) await this.phone.sync()
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
