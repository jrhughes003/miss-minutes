// Google Calendar in the real desktop app, against the local fake Google
// server (electron/google/fakeGoogle.ts). No request reaches Google.
import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { toLocalDate } from '../src/core/time'
import { FAKE_CLIENT, startFakeGoogle } from '../electron/google/fakeGoogle'

const USER_DATA = path.resolve('test-results', 'google-user-data')

test('import the client, connect, see calendar events on Today, choose calendars, disconnect', async () => {
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
  })
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const section = page.getByRole('region', { name: 'Google Calendar' })
    await expect(section.getByRole('button', { name: 'Connect Google Calendar' })).toBeDisabled()

    // A wrong file is explained, not accepted.
    await section.getByLabel('Import the OAuth client file').setInputFiles({ name: 'web.json', mimeType: 'application/json', buffer: Buffer.from('{"web":{}}') })
    await expect(section.getByRole('alert')).toContainText('Desktop app')

    const client = JSON.stringify({ installed: { client_id: FAKE_CLIENT.clientId, client_secret: FAKE_CLIENT.clientSecret } })
    await section.getByLabel('Import the OAuth client file').setInputFiles({ name: 'client.json', mimeType: 'application/json', buffer: Buffer.from(client) })
    await expect(section.getByText('Imported and stored encrypted.')).toBeVisible()

    await section.getByRole('button', { name: 'Connect Google Calendar' }).click()
    await expect(section.getByText('Connected', { exact: true })).toBeVisible()
    await expect(section.getByRole('checkbox', { name: /Work/ })).toBeChecked()
    await expect(section.getByRole('checkbox', { name: /Family/ })).not.toBeChecked()
    await expect(section.getByRole('checkbox', { name: /Colleague/ })).toBeDisabled()
    await expect(section.getByText(/Last synced (just now|\d+ min ago)/)).toBeVisible()

    // The client secret and tokens are not readable in the database file.
    const db = fs.readFileSync(path.join(USER_DATA, 'missminutes.db'))
    expect(db.includes(Buffer.from(FAKE_CLIENT.clientSecret))).toBe(false)

    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Schedule' }).getByText('Vendor demo')).toBeVisible()

    // Turning a calendar off removes its events.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await section.getByRole('checkbox', { name: /Personal/ }).uncheck()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Schedule' }).getByText('Dentist')).toHaveCount(0)

    // Disconnect forgets everything.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await section.getByRole('button', { name: 'Disconnect…' }).click()
    await section.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(section.getByRole('button', { name: 'Connect Google Calendar' })).toBeEnabled()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Schedule' }).getByText('Vendor demo')).toHaveCount(0)
    expect(fake.requests.some((r) => r.path === '/revoke')).toBe(true)
  } finally {
    await app.close()
    await fake.close()
  }
})
