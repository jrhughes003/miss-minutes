import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 1)).toEqual([])
}

test('the demo opens with sample tasks, a generated calendar and a clear demo notice', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto('/')
  await expect(page.getByRole('complementary', { name: 'About this demo' })).toBeVisible()
  // Seeded tasks, placed relative to today.
  await expect(page.getByRole('region', { name: /Overdue/ }).getByText('Submit expense report')).toBeVisible()
  // Generated calendar events on the schedule, including two that overlap.
  const schedule = page.getByRole('region', { name: 'Schedule' })
  await expect(schedule.getByText('Vendor demo')).toBeVisible()
  await expect(schedule.getByText('Dentist')).toBeVisible()
  await expectAccessible(page)

  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Plan the cottage weekend' })).toBeVisible()
  await expect(page.getByText('0/3 steps')).toBeVisible()
  await expectAccessible(page)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expectAccessible(page)
  expect(errors).toEqual([])
})

test('seeds once, keeps visitor changes across reloads, and "Start over" restores the sample data', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('New task for today').fill('My own task')
  await page.getByLabel('New task for today').press('Enter')
  await expect(page.getByRole('button', { name: 'My own task' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'My own task' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit expense report' })).toHaveCount(1) // not seeded twice

  await page.getByRole('button', { name: 'Start over…' }).click()
  await page.getByRole('button', { name: 'Reset demo data' }).click()
  await expect(page.getByRole('button', { name: 'Submit expense report' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'My own task' })).toHaveCount(0)
})

test('the privacy page is reachable and accessible', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Privacy' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
  await expect(page.getByText(/Limited Use requirements/)).toBeVisible()
  await expectAccessible(page)
  await page.getByRole('link', { name: /Back to the Miss Minutes demo/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible()
})
