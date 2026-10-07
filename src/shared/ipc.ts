// The IPC contract between the renderer and the Electron main process.
//
// This one file is the single source of truth for which requests the renderer
// may make. Three places use it:
// - the preload, which forwards only channels listed in CHANNELS;
// - the main process, which must register a handler for every channel
//   (enforced by the `Handlers` type and by electron/ipc.test.ts);
// - the renderer, which gets typed arguments and results.
//
// Adding a channel: add it to `IpcContract`. The compiler then demands an entry
// in CHANNELS and a handler in the main process.

import type { ActiveReminder, ReminderAction } from '../core/reminders/types'
import type { Settings } from '../core/settings'
import type { NewTask, Project, Task, TaskPatch, TaskQuery } from '../core/tasks/types'
import type { CalendarEvent } from '../core/today'
import type { AiPrefs, AiStatus, BreakdownResponse, CaptureResponse } from './ai'
import type { GoogleStatus } from './google'

export interface AppInfo {
  name: string
  version: string
  platform: string
  storage: 'sqlite' | 'localStorage'
  timeZone: string
}

/** Request and response types for every channel. */
export interface IpcContract {
  'app:info': { args: []; result: AppInfo }

  'tasks:list': { args: [query: TaskQuery]; result: Task[] }
  'tasks:get': { args: [id: string]; result: Task | null }
  'tasks:subtasks': { args: [parentId: string]; result: Task[] }
  'tasks:create': { args: [input: NewTask]; result: Task }
  'tasks:update': { args: [id: string, patch: TaskPatch]; result: Task }
  'tasks:complete': { args: [id: string]; result: { completed: Task; next: Task | null } }
  'tasks:reopen': { args: [id: string]; result: Task }
  'tasks:delete': { args: [id: string]; result: void }

  'projects:list': { args: []; result: Project[] }
  'projects:create': { args: [name: string, color?: string]; result: Project }
  'projects:rename': { args: [id: string, name: string]; result: Project }
  'projects:delete': { args: [id: string]; result: void }

  'tags:list': { args: []; result: string[] }

  'reminders:active': { args: []; result: ActiveReminder[] }
  'reminders:act': { args: [ruleId: string, occurrenceLocal: string, action: ReminderAction]; result: void }

  'settings:get': { args: []; result: Settings }
  'settings:set': { args: [patch: Partial<Settings>]; result: Settings }

  /** Events overlapping the local dates [from, to]. Empty until Google Calendar is connected (M5). */
  'calendar:events': { args: [from: string, to: string]; result: CalendarEvent[] }

  'google:status': { args: []; result: GoogleStatus }
  /** The Desktop-app OAuth client JSON, read from the file the user picked. Stored encrypted. */
  'google:importClient': { args: [json: string]; result: GoogleStatus }
  'google:connect': { args: []; result: GoogleStatus }
  'google:disconnect': { args: []; result: GoogleStatus }
  'google:setCalendar': { args: [id: string, selected: boolean]; result: GoogleStatus }
  'google:syncNow': { args: []; result: GoogleStatus }

  'ai:status': { args: []; result: AiStatus }
  /** Stored encrypted; never returned to the renderer. */
  'ai:setKey': { args: [key: string]; result: AiStatus }
  'ai:clearKey': { args: []; result: AiStatus }
  'ai:setPrefs': { args: [prefs: AiPrefs]; result: AiStatus }
  /** Natural-language capture: Claude if enabled, else the on-device parser. Nothing is saved. */
  'capture:parse': { args: [text: string]; result: CaptureResponse }
  /** Suggested steps for a task (by id, so the page can't send arbitrary data). Nothing is saved. */
  'breakdown:suggest': { args: [taskId: string, options: { includeNotes: boolean }]; result: BreakdownResponse }
}

export type Channel = keyof IpcContract
export type ArgsOf<C extends Channel> = IpcContract[C]['args']
export type ResultOf<C extends Channel> = IpcContract[C]['result']

// A Record over every channel, so forgetting one is a compile error. A plain
// array would let a channel be silently missing.
const CHANNEL_SET: Record<Channel, true> = {
  'app:info': true,
  'tasks:list': true,
  'tasks:get': true,
  'tasks:subtasks': true,
  'tasks:create': true,
  'tasks:update': true,
  'tasks:complete': true,
  'tasks:reopen': true,
  'tasks:delete': true,
  'projects:list': true,
  'projects:create': true,
  'projects:rename': true,
  'projects:delete': true,
  'tags:list': true,
  'reminders:active': true,
  'reminders:act': true,
  'settings:get': true,
  'settings:set': true,
  'calendar:events': true,
  'google:status': true,
  'google:importClient': true,
  'google:connect': true,
  'google:disconnect': true,
  'google:setCalendar': true,
  'google:syncNow': true,
  'ai:status': true,
  'ai:setKey': true,
  'ai:clearKey': true,
  'ai:setPrefs': true,
  'capture:parse': true,
  'breakdown:suggest': true,
}

export const CHANNELS = Object.freeze(Object.keys(CHANNEL_SET) as Channel[])

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHANNEL_SET, value)
}

/** Events pushed from main to renderer (not request/response). */
export interface PushEvents {
  /** Something changed in the database; the renderer should refetch. */
  'data:changed': { scope: 'tasks' | 'reminders' | 'projects' | 'settings' | 'calendar' | 'ai' }
  /** The user clicked a reminder notification: show that reminder. */
  'reminder:open': { ruleId: string; occurrenceLocal: string; taskId: string }
}
export type PushChannel = keyof PushEvents
export const PUSH_CHANNELS: readonly PushChannel[] = Object.freeze(['data:changed', 'reminder:open'])

/** The object the preload exposes as `window.api`. */
export interface MissMinutesApi {
  isElectron: true
  invoke<C extends Channel>(channel: C, ...args: ArgsOf<C>): Promise<ResultOf<C>>
  /** Subscribe to a push event. Returns an unsubscribe function. */
  on<P extends PushChannel>(channel: P, listener: (payload: PushEvents[P]) => void): () => void
}

// ---------------------------------------------------------------------------
// Errors across IPC
//
// Electron passes only an error's message from main to renderer, wrapped as
// "Error invoking remote method 'x': Error: <message>". To keep the error's
// kind and the offending field (so a form can highlight it), the main process
// encodes them as JSON behind a marker, and the renderer decodes them.

export interface IpcErrorInfo {
  name: string
  message: string
  field?: string
}

const MARKER = 'MM_ERROR:'

export function encodeIpcError(e: unknown): string {
  const err = e instanceof Error ? e : new Error(String(e))
  const info: IpcErrorInfo = { name: err.name, message: err.message }
  const field = (err as { field?: unknown }).field
  if (typeof field === 'string') info.field = field
  return MARKER + JSON.stringify(info)
}

export function decodeIpcError(e: unknown): IpcErrorInfo {
  const message = e instanceof Error ? e.message : String(e)
  const i = message.indexOf(MARKER)
  if (i >= 0) {
    try {
      return JSON.parse(message.slice(i + MARKER.length)) as IpcErrorInfo
    } catch {
      /* fall through */
    }
  }
  return { name: e instanceof Error ? e.name : 'Error', message }
}
