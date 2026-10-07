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

test('the demo understands typed sentences with clearly labelled simulated AI', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('New task for today').fill('Book the car service next Friday at 8am #car')
  await page.getByLabel('New task for today').press('Enter')
  const card = page.getByRole('region', { name: 'Add this task?' })
  await expect(card.getByText('Understood by simulated AI (no real model)')).toBeVisible()
  await expect(card.getByLabel(/^Time/)).toHaveValue('08:00')
  await expectAccessible(page)
  await card.getByRole('button', { name: 'Add task' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText(/no real model is called here/)).toBeVisible()
  await expectAccessible(page)
})

test('the demo suggests steps for a task, labelled as simulated', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await page.getByRole('button', { name: 'Look into a standing desk' }).click()
  const editor = page.getByRole('region', { name: 'Edit task' })
  await editor.getByRole('button', { name: 'Suggest steps' }).click()
  await expect(editor.getByText('Suggested by simulated AI (no real model)')).toBeVisible()
  await expectAccessible(page)
  await editor.getByRole('button', { name: 'Add selected steps' }).click()
  await expect(page.getByText('0/4 steps')).toBeVisible()
})

test('plans tomorrow around the calendar, creates timed tasks, and undoes it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.getByLabel(/One per line/).fill('Write the board update 1h p1\nCall the bank 15m')
  await page.getByRole('button', { name: 'Lay it out on the day' }).click()

  const blocks = page.getByRole('list', { name: 'Planned tasks' }).getByRole('listitem')
  await expect(blocks).toHaveCount(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expectAccessible(page)

  // Send one back to the tray and drag it onto the timeline by hand.
  await blocks.filter({ hasText: 'Call the bank' }).focus()
  await page.keyboard.press('Delete')
  const tray = page.getByRole('complementary', { name: 'Not placed yet' })
  const item = tray.locator('.tray-item', { hasText: 'Call the bank' })
  const grid = page.getByRole('group', { name: 'Day timeline' })
  await page.setViewportSize({ width: 1280, height: 1400 }) // room to see the tray and the evening at once
  await grid.evaluate((el) => el.parentElement!.scrollTo(0, el.parentElement!.scrollHeight)) // scroll to the evening
  await item.hover({ position: { x: 10, y: 10 } })
  await page.mouse.down()
  // 21:30 is 14.5 hours into the 07:00 day, at 1.1 px a minute: just after the demo dinner.
  const box = (await grid.boundingBox())!
  await page.mouse.move(box.x + box.width - 40, box.y + 14.5 * 60 * 1.1 + 4, { steps: 5 })
  await page.mouse.up()
  await expect(tray.getByText('Everything has a time.')).toBeVisible()
  await expect(blocks.filter({ hasText: 'Call the bank' })).toHaveAttribute('aria-label', /^Call the bank, 9:30\W+p/i)

  await page.getByRole('button', { name: /Review and confirm \(2\)/ }).click()
  await expect(page.getByRole('checkbox', { name: /Remind me 5 minutes before each/ })).toBeChecked()
  await expectAccessible(page)
  await page.getByRole('button', { name: 'Create the plan' }).click()
  await expect(page.getByRole('status').filter({ hasText: /2 new tasks/ })).toBeVisible()

  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Write the board update' })).toBeVisible()
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Write the board update' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('the light "office" theme is accessible on every page and is remembered', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark') // "terminal" is the default
  await page.getByRole('button', { name: 'Theme: Terminal' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible()
  await expectAccessible(page)

  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await page.getByRole('button', { name: 'Plan the cottage weekend' }).click()
  await expectAccessible(page)

  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.getByLabel(/One per line/).fill('Write the board update 1h p1')
  await page.getByRole('button', { name: 'Lay it out on the day' }).click()
  await expectAccessible(page)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expectAccessible(page)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: 'Theme: Office' })).toBeVisible()
})
