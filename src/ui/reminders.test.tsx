// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FakeClock, HOUR, MINUTE } from '../core/clock'
import type { Notification } from '../core/reminders/engine'
import { createLocalApi } from '../storage/api'
import { memoryStorage } from '../storage/localRepo'
import { ActiveReminders } from './ActiveReminders'
import { ClockProvider } from './clock'
import { DataProvider } from './data'
import { SettingsView } from './SettingsView'
import { TasksView } from './tasks/TasksView'

function setup() {
  const clock = new FakeClock('2026-10-06T12:00:00Z', 'America/Toronto') // 08:00 local
  const shown: Notification[] = []
  let n = 0
  const api = createLocalApi(memoryStorage(), { clock, newId: () => `id${++n}`, notifier: { show: (x) => void shown.push(x) } })
  const user = userEvent.setup()
  render(
    <ClockProvider clock={clock}>
      <DataProvider api={api}>
        <ActiveReminders />
        <TasksView />
        <SettingsView />
      </DataProvider>
    </ClockProvider>,
  )
  const tick = () => act(() => api.tickReminders())
  return { clock, api, shown, user, tick }
}

describe('reminders in the UI', () => {
  it('adds a "before due" reminder in the editor; it fires, shows in the bar, and snoozes', async () => {
    const { clock, api, shown, user, tick } = setup()
    await api.tasks.create({ title: 'Standup', due: { date: '2026-10-06', time: '09:30' } })
    await user.click(await screen.findByRole('button', { name: 'Standup' }))
    const editor = await screen.findByRole('region', { name: 'Edit task' })
    await user.selectOptions(within(editor).getByLabelText('Add a reminder'), '15 minutes before')
    expect(within(editor).getByText('15 min before')).toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: 'Save' }))
    await within(editor).findByText('Saved')

    clock.set('2026-10-06T13:15:00Z') // 09:15 local
    await tick()
    expect(shown.map((s) => s.title)).toEqual(['Standup'])
    const bar = await screen.findByRole('region', { name: 'Due reminders' })
    expect(within(bar).getByText('Standup')).toBeInTheDocument()

    await user.click(within(bar).getByRole('button', { name: 'Snooze "Standup" for 10 min' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Due reminders' })).not.toBeInTheDocument())
    clock.advance(10 * MINUTE)
    await tick()
    expect(await screen.findByRole('region', { name: 'Due reminders' })).toBeInTheDocument()
    expect(shown).toHaveLength(2)
  })

  it('adds a reminder at a fixed time, and "Done" completes the task', async () => {
    const { clock, api, user, tick } = setup()
    await api.tasks.create({ title: 'Call plumber' })
    await user.click(await screen.findByRole('button', { name: 'Call plumber' }))
    const editor = await screen.findByRole('region', { name: 'Edit task' })
    // No due date: the "before due" presets are disabled, but a fixed time works.
    expect(within(editor).getByRole('option', { name: '5 minutes before (needs a due date)' })).toBeDisabled()
    await user.selectOptions(within(editor).getByLabelText('Add a reminder'), 'At a specific time…')
    await user.clear(within(editor).getByLabelText('Reminder time'))
    await user.type(within(editor).getByLabelText('Reminder time'), '10:00')
    await user.click(within(editor).getByRole('button', { name: 'Add reminder' }))
    await user.click(within(editor).getByRole('button', { name: 'Save' }))
    await within(editor).findByText('Saved')

    clock.advance(2 * HOUR) // 10:00
    await tick()
    const bar = await screen.findByRole('region', { name: 'Due reminders' })
    await user.click(within(bar).getByRole('button', { name: 'Done: Call plumber' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Due reminders' })).not.toBeInTheDocument())
    expect((await api.tasks.list({ status: 'done' })).map((t) => t.title)).toEqual(['Call plumber'])
  })

  it('labels reminders missed while away, and dismisses them', async () => {
    const { clock, api, user, tick } = setup()
    await api.tasks.create({ title: 'Water plants', reminders: [{ when: { kind: 'at', date: '2026-10-06', time: '09:00' } }] })
    clock.advance(5 * HOUR)
    await tick()
    const bar = await screen.findByRole('region', { name: 'Due reminders' })
    expect(within(bar).getByText('Missed:')).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Dismiss: Water plants' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Due reminders' })).not.toBeInTheDocument())
  })

  it('saves the all-day reminder time, and shows the browser-only caveat', async () => {
    const { api, user } = setup()
    const input = await screen.findByLabelText('All-day reminder time')
    await user.clear(input)
    await user.type(input, '07:45')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await api.settings.get()).allDayReminderTime).toBe('07:45'))
    expect(screen.getByText(/only fire while this tab is open/)).toBeInTheDocument()
    // Start-at-login is a desktop setting; it isn't offered in the browser.
    expect(screen.queryByLabelText(/Start Miss Minutes/)).not.toBeInTheDocument()
  })
})
