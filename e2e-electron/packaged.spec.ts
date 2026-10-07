// Smoke test of the *packaged* app (release/win-unpacked), run without
// installing it. It catches what only breaks after packaging: the database
// driver inside the asar, icon paths under resources/, and loading dist/ from
// file://. The user-data override keeps it away from %APPDATA% and stops it
// registering a login item.
import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const EXE = path.resolve('release', 'win-unpacked', 'Miss Minutes.exe')
const USER_DATA = path.resolve('test-results', 'packaged-user-data')

test.skip(!fs.existsSync(EXE), 'run `npm run dist` first')

test('the packaged app starts, stores a task in SQLite, and finds its icons', async () => {
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  env.MISS_MINUTES_USER_DATA = USER_DATA
  const app = await electron.launch({ executablePath: EXE, env })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: 'Miss Minutes' })).toBeVisible()
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await app.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin)).toBe(false)
    const resources = await app.evaluate(() => process.resourcesPath)
    for (const f of ['icon.png', 'tray.png', 'tray@2x.png']) expect(fs.existsSync(path.join(resources, f)), f).toBe(true)

    await page.getByLabel('New task for today').fill('Packaged works')
    await page.getByLabel('New task for today').press('Enter')
    await expect(page.getByRole('button', { name: 'Packaged works' })).toBeVisible()
    expect(fs.existsSync(path.join(USER_DATA, 'missminutes.db'))).toBe(true)
  } finally {
    await app.close()
  }
})
