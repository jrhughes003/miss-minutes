// Google Tasks two-way sync in the real desktop app, against the local fake
// Google server. "Phone" edits go straight into the fake. No request reaches Google.
import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { toLocalDate } from '../src/core/time'
import { FAKE_CLIENT, startFakeGoogle } from '../electron/google/fakeGoogle'

const USER_DATA = path.resolve('test-results', 'gtasks-user-data')

test('turn on Tasks sync, grant access, and see edits flow both ways', async () => {
  test.setTimeout(90_000)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const fake = await startFakeGoogle({ today: toLocalDate(new Date(), zone), zone })
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'VITE_DEV_SERVER_URL') env[k] = v
  Object.assign(env, {
    MISS_MINUTES_USER_DATA: USER_DATA,
    MISS_MINUTES_GOOGLE_ENDPOINTS: JSON.stringify(fake.endpoints),
    MISS_MINUTES_HEADLESS_CONSENT: '1',
    MISS_MINUTES_TASKS_DEBOUNCE_MS: '300',
  })
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const google = page.getByRole('region', { name: 'Google Calendar' })
    const client = JSON.stringify({ installed: { client_id: FAKE_CLIENT.clientId, client_secret: FAKE_CLIENT.clientSecret } })
    await google.getByLabel('Import the OAuth client file').setInputFiles({ name: 'client.json', mimeType: 'application/json', buffer: Buffer.from(client) })
    await google.getByRole('button', { name: 'Connect Google Calendar' }).click()
    await expect(google.getByText('Connected', { exact: true })).toBeVisible()

    // Turning sync on asks for Tasks access the first time (the calendar-only grant lacks it).
    await google.getByRole('checkbox', { name: /Sync my tasks with Google Tasks/ }).check()
    await google.getByRole('button', { name: 'Allow Google Tasks access' }).click()
    await expect(google.getByText(/Tasks last synced/)).toBeVisible()

    // A task added here reaches "Google" shortly after.
    await page.getByRole('button', { name: 'Tasks', exact: true }).click()
    await page.getByLabel('New task').fill('Buy a birthday card')
    await page.getByLabel('New task').press('Enter')
    await expect.poll(() => fake.tasks.all(fake.tasks.defaultListId).map((t) => t.title), { timeout: 15_000 }).toContain('Buy a birthday card')

    // An edit "on the phone" comes back.
    const remote = fake.tasks.all(fake.tasks.defaultListId).find((t) => t.title === 'Buy a birthday card')!
    fake.tasks.edit(fake.tasks.defaultListId, remote.id, { title: 'Buy a birthday card for Sam' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await google.getByRole('button', { name: 'Sync now' }).click()
    await page.getByRole('button', { name: 'Tasks', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Buy a birthday card for Sam' })).toBeVisible()
  } finally {
    await app.close()
    await fake.close()
  }
})
