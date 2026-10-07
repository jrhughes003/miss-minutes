import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 1)).toEqual([])
}

test('tasks: add, edit, complete, and survive a reload (web build, localStorage)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()

  await page.getByLabel('New project name').fill('Errands')
  await page.getByLabel('New project name').press('Enter')
  await expect(page.getByRole('heading', { level: 2, name: 'Errands' })).toBeVisible()

  await page.getByLabel('New task').fill('Pick up prescription')
  await page.getByLabel('New task').press('Enter')
  await page.getByRole('button', { name: 'Pick up prescription' }).click()

  const editor = page.getByRole('region', { name: 'Edit task' })
  await editor.getByLabel('Due date').fill('2026-12-01')
  await editor.getByLabel('Priority').selectOption('2')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor.getByText('Saved')).toBeVisible()
  await expectNoSeriousA11yViolations(page)

  await page.reload()
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pick up prescription' })).toBeVisible()
  await expect(page.getByText('P2', { exact: true })).toBeVisible()

  // click, not check(): a completed task leaves the open list, so its box never stays ticked.
  await page.getByRole('checkbox', { name: 'Complete "Pick up prescription"' }).click()
  await expect(page.getByText('Nothing to do here')).toBeVisible()
  await expectNoSeriousA11yViolations(page)
})

test('tasks view works at phone width without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await page.getByLabel('New task').fill('A task with a fairly long title that should wrap rather than overflow the screen')
  await page.getByLabel('New task').press('Enter')
  await page.getByRole('button', { name: /A task with a fairly long title/ }).click()
  // Evaluated in the page; written as a string because e2e files are type-checked as Node code.
  const overflow = Number(await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'))
  expect(overflow).toBeLessThanOrEqual(0)
})

test('today view: quick add, schedule and accessibility', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible()
  await page.getByLabel('New task for today').fill('Water the plants')
  await page.getByLabel('New task for today').press('Enter')
  await expect(page.getByRole('region', { name: 'All day' }).getByText('Water the plants')).toBeVisible()
  await page.getByRole('button', { name: 'Water the plants' }).click()
  const editor = page.getByRole('region', { name: 'Edit task' })
  await editor.getByLabel(/^Time/).fill('23:59')
  await editor.getByLabel('Add a reminder').selectOption({ label: '15 minutes before' })
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor.getByText('Saved')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Schedule' }).getByText('Water the plants').first()).toBeVisible()
  await expectNoSeriousA11yViolations(page)
})
