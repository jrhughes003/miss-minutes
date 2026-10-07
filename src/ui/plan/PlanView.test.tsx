// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../core/clock'
import { createLocalApi } from '../../storage/api'
import { memoryStorage } from '../../storage/localRepo'
import { ClockProvider } from '../clock'
import { DataProvider } from '../data'
import { PlanView } from './PlanView'

async function setup() {
  const clock = new FakeClock('2026-10-07T15:00:00Z', 'America/Toronto') // Wed 11:00 local; plans Thursday
  let n = 0
  const api = createLocalApi(memoryStorage(), { clock, newId: () => `id${++n}` })
  await api.tasks.create({ title: 'Renew licence', due: { date: '2026-10-08', time: null }, estimateMinutes: 45 })
  const user = userEvent.setup()
  render(
    <ClockProvider clock={clock}>
      <DataProvider api={api}>
        <PlanView />
      </DataProvider>
    </ClockProvider>,
  )
  await screen.findByText('Renew licence')
  return { api, user }
}

const blocks = () => within(screen.getByRole('list', { name: 'Planned tasks' })).queryAllByRole('listitem')

describe('PlanView', () => {
  it('lays out a brain dump plus a ticked task, with breaks, and creates timed tasks with reminders', async () => {
    const { api, user } = await setup()
    await user.type(screen.getByLabelText(/One per line/), 'Write report 1h p1{Enter}Groceries 30m')
    await user.click(screen.getByRole('checkbox', { name: /Renew licence/ }))
    await user.click(screen.getByRole('button', { name: 'Lay it out on the day' }))

    // Earliest deadline first (the task due that day), then priority, from 07:00,
    // with the default 10-minute break rounded up to the 15-minute grid.
    const labels = blocks().map((li) => li.getAttribute('aria-label'))
    expect(labels).toHaveLength(3)
    expect(labels[0]).toMatch(/^Renew licence, 7:00\W+[ap]\.?m\.? to 7:45/i)
    expect(labels[1]).toMatch(/^Write report, 8:00\W+[ap]\.?m\.? to 9:00/i)
    expect(labels[2]).toMatch(/^Groceries, 9:15/)

    await user.click(screen.getByRole('button', { name: 'Review and confirm (3)' }))
    expect(screen.getByRole('checkbox', { name: /Remind me 5 minutes before each/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Create the plan' }))

    const open = await api.tasks.list({ status: 'open' })
    const report = open.find((t) => t.title === 'Write report')!
    expect(report.due).toEqual({ date: '2026-10-08', time: '08:00' })
    expect(report.estimateMinutes).toBe(60)
    expect(report.reminders.map((r) => r.when)).toEqual([{ kind: 'beforeDue', minutes: 5 }])
    expect(open.find((t) => t.title === 'Renew licence')!.due?.time).not.toBeNull()
    expect(await screen.findByRole('status')).toHaveTextContent(/2 new tasks, 1 rescheduled/)
  })

  it('moves blocks from the keyboard and blocks confirming while two overlap', async () => {
    const { user } = await setup()
    await user.type(screen.getByLabelText(/One per line/), 'A 30m{Enter}B 30m')
    await user.click(screen.getByRole('button', { name: 'Lay it out on the day' }))

    const second = blocks()[1]!
    second.focus()
    // B starts at 7:45 (after a break, on the grid); pull it up onto A.
    expect(second.getAttribute('aria-label')).toMatch(/^B, 7:45/)
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Fix these before confirming/)
    expect(screen.getByRole('button', { name: /Review and confirm/ })).toBeDisabled()

    // Delete sends it back to the tray, and Place puts it in the next free gap.
    blocks()[1]!.focus()
    await user.keyboard('{Delete}')
    expect(within(screen.getByRole('complementary', { name: 'Not placed yet' })).getByText('B')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Place B' }))
    expect(blocks()).toHaveLength(2)
    expect(screen.queryByRole('alert')?.textContent ?? null).toBeNull()
  })

  it('undoes the latest plan', async () => {
    const { api, user } = await setup()
    await user.type(screen.getByLabelText(/One per line/), 'Gym 1h')
    await user.click(screen.getByRole('button', { name: 'Lay it out on the day' }))
    await user.click(screen.getByRole('button', { name: /Review and confirm/ }))
    await user.click(screen.getByRole('button', { name: 'Create the plan' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await expect.poll(async () => (await api.tasks.list({ status: 'open' })).map((t) => t.title)).toEqual(['Renew licence'])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull())
  })
})
