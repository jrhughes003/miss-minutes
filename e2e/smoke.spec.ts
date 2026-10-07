import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('the web build loads, navigates and has no serious accessibility violations', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Miss Minutes' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([])
  // A CSP violation or a runtime error shows up as a console error.
  expect(errors).toEqual([])
})
