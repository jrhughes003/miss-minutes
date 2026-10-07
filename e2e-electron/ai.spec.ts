// AI capture in the real desktop app, against the local mock Anthropic server.
// No paid calls: the mock answers with the on-device parser behind it.
import fs from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { startMockAi } from '../electron/ai/mockServer'

const USER_DATA = path.resolve('test-results', 'ai-user-data')
const KEY = 'sk-ant-api03-test-key-not-real-0123456789'

test('save a key, capture with AI, see usage, switch AI off', async () => {
  test.setTimeout(90_000)
  const mock = await startMockAi()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'VITE_DEV_SERVER_URL') env[k] = v
  Object.assign(env, { MISS_MINUTES_USER_DATA: USER_DATA, MISS_MINUTES_AI_BASE_URL: mock.url })
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const ai = page.getByRole('region', { name: 'AI' })
    await ai.getByLabel('API key').fill('not a key')
    await ai.getByRole('button', { name: 'Save key' }).click()
    await expect(ai.getByRole('alert')).toContainText('sk-ant-')
    await ai.getByLabel('API key').fill(KEY)
    await ai.getByRole('button', { name: 'Save key' }).click()
    await expect(ai.getByText(/API key is saved \(encrypted/)).toBeVisible()
    // The key is never echoed back into the page.
    expect(await page.content()).not.toContain(KEY)

    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await page.getByLabel('New task for today').fill('Call the plumber tomorrow at 9am p1')
    await page.getByLabel('New task for today').press('Enter')
    const card = page.getByRole('region', { name: 'Add this task?' })
    await expect(card.getByText('Understood by simulated AI (no real model)')).toBeVisible()
    await card.getByRole('button', { name: 'Add task' }).click()
    await expect(card).toBeHidden()
    expect(mock.requests).toHaveLength(1)
    expect(Object.keys(mock.requests[0]!.userJson).sort()).toEqual(['nowLocal', 'projectNames', 'tagNames', 'text', 'weekday', 'zone'])

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(ai.getByRole('row', { name: /capture 1/ })).toBeVisible()
    await ai.getByRole('checkbox', { name: /Use Claude/ }).uncheck()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await page.getByLabel('New task for today').fill('Water plants tomorrow')
    await page.getByLabel('New task for today').press('Enter')
    await expect(page.getByRole('region', { name: 'Add this task?' }).getByText('Understood on this device')).toBeVisible()
    expect(mock.requests).toHaveLength(1) // AI off: nothing sent
  } finally {
    await app.close()
    await mock.close()
  }
})
