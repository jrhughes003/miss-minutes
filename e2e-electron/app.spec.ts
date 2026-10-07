// Launches the real desktop app (built main, preload and renderer) and checks
// the security-relevant wiring end to end: the bridge exists, it answers a
// contract channel, it refuses an unknown one, and Node isn't reachable from
// the page.
import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { MissMinutesApi } from '../src/shared/ipc'

// page.evaluate bodies run in the renderer, but this file is type-checked as
// Node code (no DOM lib), so reach the bridge through globalThis.
type PageGlobals = { api: MissMinutesApi }

// Tools that are themselves Electron apps (VS Code's extension host, for one)
// export ELECTRON_RUN_AS_NODE=1, which makes electron.exe start as plain Node
// and never open a window. Strip it, and the dev-server URL, from the child's
// environment.
// Each run gets a fresh user-data folder inside the project (git-ignored), so
// tests never read or write the real app's data in %APPDATA%.
const USER_DATA = path.resolve('test-results', 'electron-user-data')

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = { MISS_MINUTES_USER_DATA: USER_DATA }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'VITE_DEV_SERVER_URL') env[key] ??= value
  }
  return env
}

test.beforeEach(() => fs.rmSync(USER_DATA, { recursive: true, force: true }))

test('desktop app starts with a locked-down bridge', async () => {
  const app = await electron.launch({ args: [path.resolve('.')], env: cleanEnv() })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: 'Miss Minutes' })).toBeVisible()
    await expect(page.getByText('Storage: SQLite (desktop)')).toBeVisible()

    const info = await page.evaluate(() => (globalThis as unknown as PageGlobals).api.invoke('app:info'))
    expect(info).toMatchObject({ name: expect.any(String), storage: 'sqlite' })

    const unknown = await page.evaluate(() =>
      // Deliberately calling a channel outside the contract.
      (globalThis as unknown as { api: { invoke(c: string, ...a: unknown[]): Promise<unknown> } }).api
        .invoke('fs:readFile', 'C:/Windows/win.ini').then(() => 'allowed', (e: Error) => e.message),
    )
    expect(unknown).toMatch(/Unknown IPC channel/)

    const nodeVisible = await page.evaluate(() => typeof (globalThis as { require?: unknown }).require !== 'undefined' || typeof (globalThis as { process?: unknown }).process !== 'undefined')
    expect(nodeVisible).toBe(false)
  } finally {
    await app.close()
  }
})

test('tasks are stored in SQLite and survive a restart', async () => {
  const launch = () => electron.launch({ args: [path.resolve('.')], env: cleanEnv() })
  let app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Tasks', exact: true }).click()
    await page.getByLabel('New task').fill('Renew passport')
    await page.getByLabel('New task').press('Enter')
    await expect(page.getByRole('button', { name: 'Renew passport' })).toBeVisible()
  } finally {
    await app.close()
  }
  expect(fs.existsSync(path.join(USER_DATA, 'missminutes.db'))).toBe(true)

  app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Tasks', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Renew passport' })).toBeVisible()
    // A validation error raised in the main process reaches the page intact.
    const err = await page.evaluate(() =>
      (globalThis as unknown as PageGlobals).api.invoke('tasks:create', { title: ' ' }).then(() => '', (e: Error) => e.message),
    )
    expect(err).toContain('"field":"title"')
  } finally {
    await app.close()
  }
})

test('a reminder fires from the main process, and closing the window keeps the app in the tray', async () => {
  test.setTimeout(150_000)
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...cleanEnv(), MISS_MINUTES_TICK_MS: '500' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: 'Miss Minutes' })).toBeVisible()

    // A reminder at the start of the next local minute (reminders have minute resolution).
    const when = new Date(Math.ceil((Date.now() + 1000) / 60_000) * 60_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`
    await page.evaluate(
      ({ date, time }) =>
        (globalThis as unknown as PageGlobals).api.invoke('tasks:create', { title: 'Stretch your legs', reminders: [{ when: { kind: 'at', date, time } }] }),
      { date, time },
    )

    // Close the window: the app must keep running in the tray.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))).toEqual([false])

    // The reminder fires while the window is hidden; show it again and find it waiting.
    await expect
      .poll(async () => page.evaluate(() => (globalThis as unknown as PageGlobals).api.invoke('reminders:active').then((a) => a.length)), { timeout: 75_000 })
      .toBe(1)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.show())
    const bar = page.getByRole('region', { name: 'Due reminders' })
    await expect(bar.getByText('Stretch your legs')).toBeVisible()
    await bar.getByRole('button', { name: 'Done: Stretch your legs' }).click()
    await expect(bar).toBeHidden()
    const done = await page.evaluate(() => (globalThis as unknown as PageGlobals).api.invoke('tasks:list', { status: 'done' }))
    expect(done.map((t) => t.title)).toEqual(['Stretch your legs'])
  } finally {
    await app.close()
  }
})
