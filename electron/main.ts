// Electron main process: owns the window, the database, the reminder engine
// and, later, every network call. The renderer reaches it only through the IPC
// contract in src/shared/ipc.ts.
//
// Lifecycle (D15): closing the window hides the app to the tray, so reminders
// keep firing. "Quit" in the tray menu really quits. The packaged app also
// starts hidden at sign-in (Settings → Start at login).

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell, Tray } from 'electron'
import { systemClock } from '../src/core/clock'
import { toLocalDateTime } from '../src/core/time'
import { AiService } from './ai/service'
import { readSettings, writeSettings } from '../src/core/settings'
import { TaskService } from '../src/core/tasks/service'
import type { PushChannel, PushEvents } from '../src/shared/ipc'
import type { SqlDatabase } from './db/database'
import { openAppDatabase } from './db/open'
import { SqliteReminderLog } from './db/reminderLog'
import { sqliteSettingsStore } from './db/settingsStore'
import { SqliteTaskRepo } from './db/taskRepo'
import { registerIpcHandlers, type Handlers } from './ipc'
import { CalendarStore } from './google/calendarStore'
import { GOOGLE_ENDPOINTS, type GoogleEndpoints } from './google/oauth'
import { sqliteSecretStore } from './google/secrets'
import { GoogleService } from './google/service'
import { startReminderService } from './reminders'
import { applySessionSecurity, applyWindowSecurity } from './security'
import { makeTaskHandlers } from './taskHandlers'

const APP_ID = 'com.missminutes.app'
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const isDev = Boolean(devServerUrl)
const startHidden = process.argv.includes('--hidden')

// Tests and development runs point Electron's whole user-data folder (database,
// caches, local storage) somewhere disposable, so they never touch the real
// %APPDATA%\Miss Minutes folder. This must happen before the app is ready.
const userDataOverride = process.env.MISS_MINUTES_USER_DATA
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride))

// Icons live in build/ during development and in the app's resources folder
// when packaged (copied there by electron-builder's extraResources).
const assetDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'build')
const ICON = path.join(assetDir, 'icon.png')
const TRAY_ICON = path.join(assetDir, 'tray.png')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let db: SqlDatabase | null = null
let quitting = false
let stopReminders: (() => void) | null = null
let stopGoogleSync: (() => void) | null = null

// Tests point Google traffic at a local fake server. A real sign-in always
// goes to Google's own endpoints.
const endpointOverride = process.env.MISS_MINUTES_GOOGLE_ENDPOINTS
const googleEndpoints: GoogleEndpoints = endpointOverride ? (JSON.parse(endpointOverride) as GoogleEndpoints) : GOOGLE_ENDPOINTS
const GOOGLE_SYNC_MS = Number(process.env.MISS_MINUTES_SYNC_MS) || 5 * 60_000

/**
 * Opens the Google sign-in page in the user's browser. With a fake server (tests
 * only), it plays the consenting browser itself; that path is impossible
 * against Google's real endpoints, which need a human to sign in.
 */
async function openBrowser(url: string): Promise<void> {
  if (endpointOverride && process.env.MISS_MINUTES_HEADLESS_CONSENT === '1') {
    const res = await fetch(url, { redirect: 'manual' })
    const location = res.headers.get('location')
    if (location) await fetch(location)
    return
  }
  if (!/^https:\/\//.test(url) && !endpointOverride) throw new Error('Refusing to open a non-HTTPS sign-in URL.')
  await shell.openExternal(url)
}

function push<P extends PushChannel>(channel: P, payload: PushEvents[P]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

// Only one copy may run: two copies would both fire every reminder. A second
// launch focuses the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  void app.whenReady().then(start)
}

function start(): void {
  // Without an AppUserModelID, Windows notifications from the app can fail
  // silently (D15).
  app.setAppUserModelId(APP_ID)
  applySessionSecurity(session.defaultSession, isDev)

  // %APPDATA%\Miss Minutes\missminutes.db, outside the install folder (D24).
  try {
    db = openAppDatabase(app.getPath('userData'))
  } catch (e) {
    dialog.showErrorBox('Miss Minutes could not open its database', (e as Error).message)
    app.exit(1)
    return
  }
  const settingsStore = sqliteSettingsStore(db)
  const tasks = new TaskService(new SqliteTaskRepo(db), systemClock, randomUUID)

  const reminders = startReminderService({
    log: new SqliteReminderLog(db),
    tasks,
    clock: systemClock,
    allDayTime: () => readSettings(settingsStore).allDayReminderTime,
    icon: ICON,
    tickMs: Number(process.env.MISS_MINUTES_TICK_MS) || undefined,
    onChange: () => push('data:changed', { scope: 'reminders' }),
    onOpen: (r) => {
      showMainWindow()
      if (r) push('reminder:open', r)
    },
  })
  stopReminders = reminders.stop

  applyLoginItem(readSettings(settingsStore).startAtLogin)

  const secrets = sqliteSecretStore(db, {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  })
  // AI calls go to the real Anthropic API unless a mock server URL is set
  // (development: `npm run ai:mock`; tests).
  const ai = new AiService({ db, secrets, settings: settingsStore, clock: systemClock, baseURL: process.env.MISS_MINUTES_AI_BASE_URL || undefined })
  const aiChanged = <T>(value: T): T => {
    push('data:changed', { scope: 'ai' })
    return value
  }
  const google = new GoogleService({
    fetch,
    endpoints: googleEndpoints,
    secrets,
    store: new CalendarStore(db),
    clock: systemClock,
    openBrowser,
    onChange: () => push('data:changed', { scope: 'calendar' }),
  })
  // Sync every few minutes, and when the window gains focus (at most once a minute).
  const syncTimer = setInterval(() => void google.sync(), GOOGLE_SYNC_MS)
  let lastFocusSync = 0
  const onFocus = () => {
    if (Date.now() - lastFocusSync > 60_000) {
      lastFocusSync = Date.now()
      void google.sync()
    }
  }
  app.on('browser-window-focus', onFocus)
  stopGoogleSync = () => {
    clearInterval(syncTimer)
    app.removeListener('browser-window-focus', onFocus)
  }
  void google.sync()

  const handlers: Handlers = {
    'app:info': () => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      storage: 'sqlite',
      timeZone: systemClock.zone(),
    }),
    ...makeTaskHandlers(tasks, (e) => {
      push('data:changed', e)
      // A new or moved reminder might already be due; don't wait for the next tick.
      if (e.scope === 'tasks') reminders.engine.tick()
    }),
    'reminders:active': () => reminders.engine.active(),
    'reminders:act': (ruleId, occurrenceLocal, action) => {
      reminders.engine.act(ruleId, occurrenceLocal, action)
      if (action.kind === 'done') push('data:changed', { scope: 'tasks' })
    },
    'calendar:events': (from, to) => google.events(from, to),
    'google:status': () => google.status(),
    'google:importClient': (json) => google.importClient(json),
    'google:connect': () => google.connect(),
    'google:disconnect': () => google.disconnect(),
    'google:setCalendar': (id, selected) => google.setCalendar(id, selected),
    'google:syncNow': async () => {
      await google.sync()
      return google.status()
    },
    'ai:status': () => ai.status(),
    'ai:setKey': (key) => aiChanged(ai.setKey(key)),
    'ai:clearKey': () => aiChanged(ai.clearKey()),
    'ai:setPrefs': (prefs) => aiChanged(ai.setPrefs(prefs)),
    'breakdown:suggest': async (taskId, options) => {
      const task = tasks.getTask(taskId)
      if (!task) throw new Error('That task no longer exists.')
      const project = task.projectId ? tasks.listProjects().find((p) => p.id === task.projectId)?.name ?? null : null
      const response = await ai.breakdown({
        title: task.title,
        ...(options.includeNotes && task.notes ? { notes: task.notes } : {}),
        projectName: project,
        due: task.due ? `${task.due.date}${task.due.time ? ` ${task.due.time}` : ''}` : null,
      })
      push('data:changed', { scope: 'ai' })
      return response
    },
    'capture:parse': async (text) => {
      const now = systemClock.now()
      const response = await ai.capture(text, {
        nowLocal: toLocalDateTime(now, systemClock.zone()),
        zone: systemClock.zone(),
        projectNames: tasks.listProjects().map((p) => p.name),
        tagNames: tasks.listTags(),
      })
      push('data:changed', { scope: 'ai' })
      return response
    },
    'settings:get': () => readSettings(settingsStore),
    'settings:set': (patch) => {
      const next = writeSettings(settingsStore, patch)
      applyLoginItem(next.startAtLogin)
      push('data:changed', { scope: 'settings' })
      return next
    },
  }
  registerIpcHandlers(ipcMain, handlers, { devServerUrl })

  createTray()
  if (!startHidden) showMainWindow()
  app.on('activate', () => showMainWindow())
}

/**
 * Registers (or removes) the app as a Windows login item. Only for the
 * installed app: in development it would register the bare electron.exe, and
 * a test run (user-data override set) must never change the user's login items.
 */
function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged || userDataOverride) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

function createTray(): void {
  tray = new Tray(TRAY_ICON)
  tray.setToolTip('Miss Minutes')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Miss Minutes', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => showMainWindow())
}

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 380,
    minHeight: 500,
    title: 'Miss Minutes',
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  applyWindowSecurity(mainWindow, devServerUrl)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // Closing hides to the tray, so reminders keep running.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (devServerUrl) void mainWindow.loadURL(devServerUrl)
  else void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

// Quitting from anywhere (tray, OS shutdown, an installer update) must close
// the window for real rather than hide it.
app.on('before-quit', () => {
  quitting = true
})

// The app lives in the tray; closing the last window doesn't quit it.
app.on('window-all-closed', () => {
  /* stay running */
})

app.on('will-quit', () => {
  stopReminders?.()
  stopGoogleSync?.()
  tray?.destroy()
  db?.close()
  db = null
})
