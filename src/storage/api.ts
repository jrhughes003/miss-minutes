// The renderer's single doorway to data (the financeflow pattern, D7).
//
// UI code calls `api.tasks.create(...)` and never knows where the data lives:
// - desktop: each call goes over IPC to TaskService + SQLite in the main process;
// - browser: the same TaskService runs right here, over localStorage.
// Both return Promises, so components are written once.

import { systemClock, type Clock } from '../core/clock'
import { ReminderEngine, type Notifier } from '../core/reminders/engine'
import type { ActiveReminder, ReminderAction } from '../core/reminders/types'
import { readSettings, writeSettings, type Settings } from '../core/settings'
import { ValidationError } from '../core/tasks/normalize'
import { TaskService } from '../core/tasks/service'
import type { NewTask, Project, Task, TaskPatch, TaskQuery } from '../core/tasks/types'
import type { CalendarEvent } from '../core/today'
import { toLocalDate } from '../core/time'
import { parseBaseline } from '../core/capture/baseline'
import { toLocalDateTime } from '../core/time'
import { mockBreakdown } from '../core/breakdown/mock'
import { UNAVAILABLE_AI, type AiPrefs, type AiStatus, type BreakdownResponse, type CaptureResponse } from '../shared/ai'
import { UNAVAILABLE_GOOGLE, type GoogleStatus } from '../shared/google'
import { decodeIpcError, type MissMinutesApi, type PushEvents } from '../shared/ipc'
import { fakeEventsBetween } from '../demo/fakeCalendar'
import { DEMO_SEEDED_KEY, seedDemo } from '../demo/seed'
import { LocalReminderLog } from './localReminderLog'
import { LocalTaskRepo, memoryStorage, type KeyValueStorage } from './localRepo'
import { bridge } from './runtime'

export type ChangeScope = PushEvents['data:changed']['scope']

export interface DataApi {
  tasks: {
    list(query?: TaskQuery): Promise<Task[]>
    get(id: string): Promise<Task | null>
    subtasks(parentId: string): Promise<Task[]>
    create(input: NewTask): Promise<Task>
    update(id: string, patch: TaskPatch): Promise<Task>
    complete(id: string): Promise<{ completed: Task; next: Task | null }>
    reopen(id: string): Promise<Task>
    delete(id: string): Promise<void>
  }
  projects: {
    list(): Promise<Project[]>
    create(name: string, color?: string): Promise<Project>
    rename(id: string, name: string): Promise<Project>
    delete(id: string): Promise<void>
  }
  tags: { list(): Promise<string[]> }
  reminders: {
    active(): Promise<ActiveReminder[]>
    act(ruleId: string, occurrenceLocal: string, action: ReminderAction): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  calendar: {
    /** Events overlapping the local dates [from, to], inclusive. */
    events(from: string, to: string): Promise<CalendarEvent[]>
  }
  /** Google connection (desktop only; the web build reports it unavailable). */
  google: {
    status(): Promise<GoogleStatus>
    importClient(json: string): Promise<GoogleStatus>
    connect(): Promise<GoogleStatus>
    disconnect(): Promise<GoogleStatus>
    setCalendar(id: string, selected: boolean): Promise<GoogleStatus>
    syncNow(): Promise<GoogleStatus>
    setTasksSync(enabled: boolean): Promise<GoogleStatus>
    setPhoneReminders(enabled: boolean): Promise<GoogleStatus>
  }
  ai: {
    status(): Promise<AiStatus>
    setKey(key: string): Promise<AiStatus>
    clearKey(): Promise<AiStatus>
    setPrefs(prefs: AiPrefs): Promise<AiStatus>
  }
  capture: {
    /** Understands a typed sentence. Saves nothing: the UI shows a preview first. */
    parse(text: string): Promise<CaptureResponse>
  }
  breakdown: {
    /** Suggested steps for a task. Saves nothing: the UI lets the user pick. */
    suggest(taskId: string, options: { includeNotes: boolean }): Promise<BreakdownResponse>
  }
  /** True in the hosted web demo: sample data and a generated calendar. */
  isDemo: boolean
  /** Called after any change, from this window or (desktop) the main process. */
  onChange(listener: (scope: ChangeScope) => void): () => void
  /** Called when the user clicks a reminder notification. */
  onReminderOpen(listener: (r: { ruleId: string; occurrenceLocal: string; taskId: string }) => void): () => void
}

/** An error the UI can show: a message, and the form field it belongs to if any. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly kind = 'Error',
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  if (e instanceof ValidationError) return new AppError(e.message, e.field, e.name)
  const info = decodeIpcError(e)
  return new AppError(info.message, info.field, info.name)
}

// ---------------------------------------------------------------------------

export function createIpcApi(b: MissMinutesApi): DataApi {
  const call = async <T>(p: Promise<T>): Promise<T> => {
    try {
      return await p
    } catch (e) {
      throw toAppError(e)
    }
  }
  return {
    tasks: {
      list: (q = {}) => call(b.invoke('tasks:list', q)),
      get: (id) => call(b.invoke('tasks:get', id)),
      subtasks: (id) => call(b.invoke('tasks:subtasks', id)),
      create: (input) => call(b.invoke('tasks:create', input)),
      update: (id, patch) => call(b.invoke('tasks:update', id, patch)),
      complete: (id) => call(b.invoke('tasks:complete', id)),
      reopen: (id) => call(b.invoke('tasks:reopen', id)),
      delete: (id) => call(b.invoke('tasks:delete', id)),
    },
    projects: {
      list: () => call(b.invoke('projects:list')),
      create: (name, color) => call(color === undefined ? b.invoke('projects:create', name) : b.invoke('projects:create', name, color)),
      rename: (id, name) => call(b.invoke('projects:rename', id, name)),
      delete: (id) => call(b.invoke('projects:delete', id)),
    },
    tags: { list: () => call(b.invoke('tags:list')) },
    reminders: {
      active: () => call(b.invoke('reminders:active')),
      act: (ruleId, occ, action) => call(b.invoke('reminders:act', ruleId, occ, action)),
    },
    settings: {
      get: () => call(b.invoke('settings:get')),
      set: (patch) => call(b.invoke('settings:set', patch)),
    },
    calendar: { events: (from, to) => call(b.invoke('calendar:events', from, to)) },
    ai: {
      status: () => call(b.invoke('ai:status')),
      setKey: (key) => call(b.invoke('ai:setKey', key)),
      clearKey: () => call(b.invoke('ai:clearKey')),
      setPrefs: (prefs) => call(b.invoke('ai:setPrefs', prefs)),
    },
    capture: { parse: (text) => call(b.invoke('capture:parse', text)) },
    breakdown: { suggest: (taskId, options) => call(b.invoke('breakdown:suggest', taskId, options)) },
    google: {
      status: () => call(b.invoke('google:status')),
      importClient: (json) => call(b.invoke('google:importClient', json)),
      connect: () => call(b.invoke('google:connect')),
      disconnect: () => call(b.invoke('google:disconnect')),
      setCalendar: (id, selected) => call(b.invoke('google:setCalendar', id, selected)),
      syncNow: () => call(b.invoke('google:syncNow')),
      setTasksSync: (enabled) => call(b.invoke('google:setTasksSync', enabled)),
      setPhoneReminders: (enabled) => call(b.invoke('google:setPhoneReminders', enabled)),
    },
    isDemo: false,
    onChange: (listener) => b.on('data:changed', (e) => listener(e.scope)),
    onReminderOpen: (listener) => b.on('reminder:open', listener),
  }
}

/**
 * Shows reminders in the browser (web demo) with the Notification API. They
 * can only fire while the tab is open; the demo says so. Permission is asked
 * for only when the user first adds a reminder (see ReminderField), never on
 * page load.
 */
export const browserNotifier: Notifier = {
  show(n) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(n.title, { body: n.body, icon: './favicon.svg', tag: n.reminder ? `${n.reminder.ruleId}|${n.reminder.occurrenceLocal}` : undefined })
  },
}

export interface LocalApiOptions {
  clock?: Clock
  newId?: () => string
  notifier?: Notifier
  /** Check for due reminders on this interval (ms); 0 disables the timer (tests call tick themselves). */
  tickMs?: number
  /** Demo mode: show the generated fake calendar. */
  demo?: boolean
}

export function createLocalApi(storage: KeyValueStorage, options: LocalApiOptions = {}): DataApi & { tickReminders: () => void } {
  const clock = options.clock ?? systemClock
  const service = new TaskService(new LocalTaskRepo(storage), clock, options.newId ?? (() => crypto.randomUUID()))
  const settingsStore = {
    get: (k: string) => storage.getItem(`miss-minutes:setting:${k}`),
    set: (k: string, v: string) => storage.setItem(`miss-minutes:setting:${k}`, v),
  }
  const listeners = new Set<(scope: ChangeScope) => void>()
  const emit = (scope: ChangeScope) => listeners.forEach((l) => l(scope))
  const engine = new ReminderEngine({
    log: new LocalReminderLog(storage),
    tasks: service,
    clock,
    notifier: options.notifier ?? { show: () => {} },
    allDayTime: () => readSettings(settingsStore).allDayReminderTime,
    onChange: () => emit('reminders'),
  })
  const tickReminders = () => {
    try {
      engine.tick()
    } catch (e) {
      console.error('Miss Minutes: reminder check failed', e)
    }
  }
  if (options.tickMs) {
    setInterval(tickReminders, options.tickMs)
    // Browsers throttle timers in background tabs; check again on return.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tickReminders())
    setTimeout(tickReminders, 0)
  }

  // Run synchronously but answer asynchronously, like the IPC version, so
  // components behave the same in both builds.
  const read = <T>(fn: () => T): Promise<T> => {
    try {
      return Promise.resolve(fn())
    } catch (e) {
      return Promise.reject(toAppError(e))
    }
  }
  const write = <T>(scope: ChangeScope, fn: () => T): Promise<T> =>
    read(fn).then((value) => {
      emit(scope)
      // A new or moved reminder might already be due.
      if (scope === 'tasks') tickReminders()
      return value
    })

  return {
    tasks: {
      list: (q = {}) => read(() => service.listTasks(q)),
      get: (id) => read(() => service.getTask(id)),
      subtasks: (id) => read(() => service.subtasksOf(id)),
      create: (input) => write('tasks', () => service.createTask(input)),
      update: (id, patch) => write('tasks', () => service.updateTask(id, patch)),
      complete: (id) => write('tasks', () => service.completeTask(id)),
      reopen: (id) => write('tasks', () => service.reopenTask(id)),
      delete: (id) => write('tasks', () => service.deleteTask(id)),
    },
    projects: {
      list: () => read(() => service.listProjects()),
      create: (name, color) => write('projects', () => service.createProject(name, color)),
      rename: (id, name) => write('projects', () => service.renameProject(id, name)),
      delete: (id) => write('projects', () => service.deleteProject(id)),
    },
    tags: { list: () => read(() => service.listTags()) },
    reminders: {
      active: () => read(() => engine.active()),
      act: (ruleId, occ, action) => write(action.kind === 'done' ? 'tasks' : 'reminders', () => engine.act(ruleId, occ, action)),
    },
    settings: {
      get: () => read(() => readSettings(settingsStore)),
      set: (patch) => write('settings', () => writeSettings(settingsStore, patch)),
    },
    calendar: {
      events: (from, to) => read(() => (options.demo ? fakeEventsBetween(toLocalDate(clock.now(), clock.zone()), clock.zone(), from, to) : [])),
    },
    ai: {
      // The demo simulates AI (clearly labelled); the plain web build has none.
      status: () => read(() => (options.demo ? demoAiStatus(storage) : UNAVAILABLE_AI)),
      setKey: () => Promise.reject(new AppError('API keys can only be stored in the desktop app.')),
      clearKey: () => Promise.resolve(UNAVAILABLE_AI),
      setPrefs: () => Promise.resolve(options.demo ? demoAiStatus(storage) : UNAVAILABLE_AI),
    },
    capture: {
      parse: (text) =>
        read((): CaptureResponse => {
          const now = clock.now()
          const result = parseBaseline(text, {
            nowLocal: toLocalDateTime(now, clock.zone()),
            zone: clock.zone(),
            projectNames: service.listProjects().map((p) => p.name),
            tagNames: service.listTags(),
          })
          if (!options.demo) return { result, source: 'device', note: null }
          recordDemoUsage(storage, text)
          emit('ai')
          return { result, source: 'mock', note: null }
        }),
    },
    breakdown: {
      suggest: (taskId) =>
        read((): BreakdownResponse => {
          if (!options.demo) return { steps: [], source: 'none', note: 'Suggested steps need AI, available in the desktop app with your own API key.' }
          const task = service.getTask(taskId)
          if (!task) throw new AppError('That task no longer exists.')
          recordDemoUsage(storage, task.title)
          emit('ai')
          return { steps: mockBreakdown(task.title), source: 'mock', note: null }
        }),
    },
    google: {
      status: () => Promise.resolve(UNAVAILABLE_GOOGLE),
      importClient: () => Promise.reject(new AppError('Google Calendar is available in the desktop app.')),
      connect: () => Promise.reject(new AppError('Google Calendar is available in the desktop app.')),
      disconnect: () => Promise.resolve(UNAVAILABLE_GOOGLE),
      setCalendar: () => Promise.resolve(UNAVAILABLE_GOOGLE),
      syncNow: () => Promise.resolve(UNAVAILABLE_GOOGLE),
      setTasksSync: () => Promise.resolve(UNAVAILABLE_GOOGLE),
      setPhoneReminders: () => Promise.resolve(UNAVAILABLE_GOOGLE),
    },
    isDemo: Boolean(options.demo),
    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    // Browser notifications can't carry a click back into the page reliably; the active-reminders bar covers it.
    onReminderOpen: () => () => {},
    tickReminders,
  }
}

function defaultApi(): DataApi {
  if (bridge) return createIpcApi(bridge)
  // localStorage can be missing or throw (private mode, blocked site data);
  // fall back to memory so the demo still works for the visit.
  let storage: KeyValueStorage
  try {
    storage = window.localStorage
    storage.getItem('probe')
  } catch {
    storage = memoryStorage()
  }
  const demo = import.meta.env.VITE_DEMO_MODE === '1'
  const local = createLocalApi(storage, { notifier: browserNotifier, tickMs: 30_000, demo })
  if (demo && storage.getItem(DEMO_SEEDED_KEY) === null) {
    // Mark first, so a failure part-way never seeds twice on reload.
    storage.setItem(DEMO_SEEDED_KEY, new Date().toISOString())
    void seedDemo(local, toLocalDate(new Date(), systemClock.zone())).catch((e: unknown) => console.error('Miss Minutes: demo seeding failed', e))
  }
  return local
}

// --- Demo AI: simulated, and labelled as such everywhere it shows ------------

const DEMO_USAGE_KEY = 'miss-minutes:demo-ai-usage:v1'

function recordDemoUsage(storage: KeyValueStorage, text: string): void {
  const u = JSON.parse(storage.getItem(DEMO_USAGE_KEY) ?? '{"calls":0,"input":0,"output":0}') as { calls: number; input: number; output: number }
  // Roughly what a real Haiku 4.5 capture uses: the prompt plus the sentence in, a short JSON out.
  u.calls++
  u.input += 900 + Math.ceil(text.length / 4)
  u.output += 120
  storage.setItem(DEMO_USAGE_KEY, JSON.stringify(u))
}

function demoAiStatus(storage: KeyValueStorage): AiStatus {
  const u = JSON.parse(storage.getItem(DEMO_USAGE_KEY) ?? '{"calls":0,"input":0,"output":0}') as { calls: number; input: number; output: number }
  const cost = (u.input * 1 + u.output * 5) / 1_000_000
  const summary = { calls: u.calls, costUsd: cost, inputTokens: u.input, outputTokens: u.output }
  return { ...UNAVAILABLE_AI, available: true, keySet: true, enabled: true, mock: true, simulated: true, model: 'claude-haiku-4-5 (simulated)', monthToDate: summary, byFeature: u.calls ? { capture: summary } : {}, pricesAsOf: '2026-09-25' }
}

/** Clears everything the web build stored (demo reset). */
export function clearLocalData(storage: Storage): void {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith('miss-minutes:')) keys.push(k)
  }
  keys.forEach((k) => storage.removeItem(k))
}

export const api: DataApi = typeof window === 'undefined' ? createLocalApi(memoryStorage()) : defaultApi()
