// 📱 phone reminders in the real desktop app, against the local fake Google
// server. No request reaches Google.
import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { toLocalDate } from '../src/core/time'
import { FAKE_CLIENT, startFakeGoogle } from '../electron/google/fakeGoogle'

const USER_DATA = path.resolve('test-results', 'phone-user-data')

test('a reminder marked 📱 becomes an event with an alert on the app’s own calendar', async () => {
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
    await google.getByRole('checkbox', { name: /Send reminders I mark 📱/ }).check()
    await google.getByRole('button', { name: 'Allow phone reminders' }).click()
    await expect(google.getByRole('button', { name: 'Allow phone reminders' })).toBeHidden()

    // A task due tomorrow afternoon with a reminder, then mark the reminder 📱.
    await page.getByRole('button', { name: 'Tasks', exact: true }).click()
    await page.getByLabel('New task').fill('remind me to call the dentist tomorrow at 3pm')
    await page.getByLabel('New task').press('Enter')
    await page.getByRole('region', { name: 'Add this task?' }).getByRole('button', { name: 'Add task' }).click()
    await page.getByRole('button', { name: 'call the dentist' }).click()
    const editor = page.getByRole('region', { name: 'Edit task' })
    await editor.getByRole('checkbox', { name: /Also on my phone/ }).check()
    await editor.getByRole('button', { name: 'Save' }).click()

    await expect
      .poll(() => fake.calendarList().find((c) => c.summary === 'Miss Minutes reminders'), { timeout: 15_000 })
      .toBeTruthy()
    const calendarId = fake.calendarList().find((c) => c.summary === 'Miss Minutes reminders')!.id
    await expect.poll(() => fake.calendarEvents(calendarId).map((e) => e.summary), { timeout: 15_000 }).toEqual(['⏰ call the dentist'])
    expect(fake.calendarEvents(calendarId)[0]!.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] })

    // The app's own calendar isn't offered as a calendar to show (it would duplicate reminders).
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await google.getByRole('button', { name: 'Sync now' }).click()
    await expect(google.getByRole('checkbox', { name: /Miss Minutes reminders/ })).toHaveCount(0)
  } finally {
    await app.close()
    await fake.close()
  }
})
