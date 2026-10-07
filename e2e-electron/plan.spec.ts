// "Plan my day" in the real desktop app, against the local fake Google
// server: tasks get times and reminders, blocks go onto a calendar you own,
// and Undo takes both back. No request reaches Google.
import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { addDays, toLocalDate } from '../src/core/time'
import { FAKE_CLIENT, startFakeGoogle } from '../electron/google/fakeGoogle'

const USER_DATA = path.resolve('test-results', 'plan-user-data')

test('plans tomorrow, puts the blocks on my own calendar, and undoes it all', async () => {
  test.setTimeout(90_000)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = toLocalDate(new Date(), zone)
  const fake = await startFakeGoogle({ today, zone })
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'VITE_DEV_SERVER_URL') env[k] = v
  Object.assign(env, {
    MISS_MINUTES_USER_DATA: USER_DATA,
    MISS_MINUTES_GOOGLE_ENDPOINTS: JSON.stringify(fake.endpoints),
    MISS_MINUTES_HEADLESS_CONSENT: '1',
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

    await page.getByRole('button', { name: 'Plan', exact: true }).click()
    await page.getByLabel(/One per line/).fill('Deep work on the proposal 1h p1\nCall the bank 15m')
    await page.getByRole('button', { name: 'Lay it out on the day' }).click()
    // The fake calendar's events for tomorrow are on the timeline, and nothing overlaps them.
    await expect(page.getByRole('list', { name: 'Planned tasks' }).getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: /Review and confirm \(2\)/ }).click()

    // Blocks need one more permission (events on calendars you own); asked only now.
    await page.getByRole('button', { name: 'Allow calendar blocks' }).click()
    const calendar = page.getByRole('combobox', { name: 'Calendar' })
    await expect(calendar).toHaveValue('me@example.com') // the primary calendar
    await page.getByRole('button', { name: 'Create the plan' }).click()
    await expect(page.getByRole('status').filter({ hasText: /2 new tasks, 2 calendar blocks/ })).toBeVisible()

    const blocks = () => fake.calendarEvents('me@example.com').filter((e) => e.extendedProperties?.private?.mmBatch)
    await expect.poll(() => blocks().map((e) => e.summary).sort(), { timeout: 15_000 }).toEqual(['Call the bank', 'Deep work on the proposal'])
    const tomorrow = addDays(today, 1)
    for (const e of blocks()) expect(toLocalDate(new Date(e.start!.dateTime!), zone)).toBe(tomorrow)

    // The tasks have times and a 5-minute reminder.
    await page.getByRole('button', { name: 'Tasks', exact: true }).click()
    await page.getByRole('button', { name: 'Deep work on the proposal' }).click()
    const editor = page.getByRole('region', { name: 'Edit task' })
    await expect(editor.getByLabel(/^Time/)).not.toHaveValue('')
    await expect(editor.getByRole('button', { name: 'Remove reminder: 5 min before' })).toBeVisible()

    // Undo removes the tasks and the blocks.
    await page.getByRole('button', { name: 'Plan', exact: true }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    await expect.poll(() => blocks().length, { timeout: 15_000 }).toBe(0)
    await page.getByRole('button', { name: 'Tasks', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Deep work on the proposal' })).toHaveCount(0)
  } finally {
    await app.close()
    await fake.close()
  }
})
