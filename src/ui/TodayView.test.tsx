// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '../core/clock'
import { createLocalApi } from '../storage/api'
import { memoryStorage } from '../storage/localRepo'
import { ClockProvider } from './clock'
import { DataProvider } from './data'
import { TodayView } from './TodayView'

async function setup() {
  const clock = new FakeClock('2026-10-06T15:00:00Z', 'America/Toronto') // Tue 11:00 local
  let n = 0
  const api = createLocalApi(memoryStorage(), { clock, newId: () => `id${++n}` })
  await api.tasks.create({ title: 'Renew licence', due: { date: '2026-10-02', time: null } })
  await api.tasks.create({ title: 'Gym', due: { date: '2026-10-06', time: null } })
  await api.tasks.create({ title: 'Standup', due: { date: '2026-10-06', time: '09:30' } })
  await api.tasks.create({ title: 'Dentist', due: { date: '2026-10-06', time: '14:00' }, reminders: [{ when: { kind: 'beforeDue', minutes: 60 } }] })
  await api.tasks.create({ title: 'Read that article' })
  await api.tasks.create({ title: 'Friday thing', due: { date: '2026-10-09', time: null } })
  const onOpenTasks = vi.fn()
  const user = userEvent.setup()
  render(
    <ClockProvider clock={clock}>
      <DataProvider api={api}>
        <TodayView onOpenTasks={onOpenTasks} />
      </DataProvider>
    </ClockProvider>,
  )
  await screen.findByText('Standup')
  return { api, user, onOpenTasks }
}

const section = (name: RegExp | string) => screen.getByRole('region', { name })

describe('TodayView', () => {
  it('shows overdue, all-day, the timed schedule with reminders and a now line, and the inbox', async () => {
    await setup()
    expect(screen.getByText('Tuesday, October 6')).toBeInTheDocument()
    expect(within(section(/Overdue/)).getByText('Renew licence')).toBeInTheDocument()
    expect(within(section('All day')).getByText('Gym')).toBeInTheDocument()

    const items = within(section('Schedule')).getAllByRole('listitem').filter((li) => li.parentElement?.classList.contains('timeline'))
    const text = items.map((li) => li.textContent?.replace(/\s+/g, ' ').trim())
    // Standup (past), then Now, then the dentist reminder an hour before, then the dentist.
    expect(text[0]).toMatch(/Standup/)
    expect(text[1]).toMatch(/Now/)
    expect(text[2]).toMatch(/Reminder: Dentist/)
    expect(text[3]).toMatch(/Dentist/)

    expect(within(section(/Inbox/)).getByText('Read that article')).toBeInTheDocument()
    expect(screen.getByText(/1 task coming up this week/)).toBeInTheDocument()
  })

  it('adds a task due today from the quick-add box', async () => {
    const { user } = await setup()
    await user.type(screen.getByLabelText('New task for today'), 'Buy stamps{Enter}')
    expect(await within(section('All day')).findByText('Buy stamps')).toBeInTheDocument()
  })

  it('completes an overdue task from Today', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('checkbox', { name: 'Complete "Renew licence"' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: /Overdue/ })).not.toBeInTheDocument())
  })

  it('opens a task in the editor, and links to the full task list', async () => {
    const { user, onOpenTasks } = await setup()
    await user.click(screen.getByRole('button', { name: 'Gym' }))
    expect(await screen.findByRole('region', { name: 'Edit task' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open all tasks' }))
    expect(onOpenTasks).toHaveBeenCalled()
  })
})
