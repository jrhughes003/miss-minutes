// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '../../core/clock'
import type { CaptureResponse } from '../../shared/ai'
import { createLocalApi, type DataApi } from '../../storage/api'
import { memoryStorage } from '../../storage/localRepo'
import { AiSettings } from '../AiSettings'
import { ClockProvider } from '../clock'
import { DataProvider } from '../data'
import { CaptureBox } from './CaptureBox'

const clock = new FakeClock('2026-10-06T14:00:00Z', 'America/Toronto') // Tue 10:00

function setup(o: { demo?: boolean; parse?: DataApi['capture']['parse'] } = {}) {
  let n = 0
  const base = createLocalApi(memoryStorage(), { clock, newId: () => `id${++n}`, demo: Boolean(o.demo) })
  const api: DataApi = o.parse ? { ...base, capture: { parse: o.parse } } : base
  const user = userEvent.setup()
  render(
    <ClockProvider clock={clock}>
      <DataProvider api={api}>
        <CaptureBox label="New task" placeholder="Add a task" defaultDue={{ date: '2026-10-06', time: null }} />
        <AiSettings />
      </DataProvider>
    </ClockProvider>,
  )
  return { api, user }
}

describe('CaptureBox', () => {
  it('previews what it understood, lets you fix it, and adds the task only on confirm', async () => {
    const { api, user } = setup()
    await api.projects.create('Health')
    await user.type(screen.getByLabelText('New task'), 'Call the dentist Thursday at 3pm p2 #checkup{Enter}')
    const card = await screen.findByRole('region', { name: 'Add this task?' })
    expect(within(card).getByLabelText('Title')).toHaveValue('Call the dentist')
    expect(within(card).getByLabelText('Due date')).toHaveValue('2026-10-08')
    expect(within(card).getByLabelText(/^Time/)).toHaveValue('15:00')
    expect(within(card).getByText('Understood on this device')).toBeInTheDocument()
    expect(await api.tasks.list()).toEqual([]) // nothing saved yet

    await user.clear(within(card).getByLabelText(/^Time/))
    await user.type(within(card).getByLabelText(/^Time/), '15:30')
    await user.click(within(card).getByRole('button', { name: 'Add task' }))
    await waitFor(async () => expect(await api.tasks.list()).toHaveLength(1))
    expect((await api.tasks.list())[0]).toMatchObject({ title: 'Call the dentist', due: { date: '2026-10-08', time: '15:30' }, priority: 2, tags: ['checkup'] })
    expect(screen.queryByRole('region', { name: 'Add this task?' })).not.toBeInTheDocument()
  })

  it('adds a plain sentence straight away, with the default due date', async () => {
    const { api, user } = setup()
    await user.type(screen.getByLabelText('New task'), 'Buy milk{Enter}')
    await waitFor(async () => expect(await api.tasks.list()).toHaveLength(1))
    expect((await api.tasks.list())[0]).toMatchObject({ title: 'Buy milk', due: { date: '2026-10-06', time: null } })
  })

  it('carries repeats and reminders through, and lets you untick them', async () => {
    const { api, user } = setup()
    await user.type(screen.getByLabelText('New task'), 'remind me to stretch every weekday at 3pm{Enter}')
    const card = await screen.findByRole('region', { name: 'Add this task?' })
    await user.click(within(card).getByRole('checkbox', { name: /Remind me at the due time/ }))
    await user.click(within(card).getByRole('button', { name: 'Add task' }))
    await waitFor(async () => expect(await api.tasks.list()).toHaveLength(1))
    const [t] = await api.tasks.list()
    expect(t!.recurrence).toEqual({ kind: 'rule', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' })
    expect(t!.reminders).toEqual([])
  })

  it('asks the clarifying question, and retries with the answer', async () => {
    const parse = vi.fn(async (text: string): Promise<CaptureResponse> => {
      const base = { title: 'Meeting', priority: 4 as const, projectName: null, tags: [], recurrence: null, reminderMinutesBefore: null }
      return text.includes('(next week)')
        ? { source: 'claude', note: null, result: { ...base, kind: 'task', due: { date: '2026-10-13', time: null }, question: null } }
        : { source: 'claude', note: null, result: { ...base, kind: 'clarify', due: null, question: 'Today, or next Tuesday?' } }
    })
    const { user } = setup({ parse })
    await user.type(screen.getByLabelText('New task'), 'Meeting Tuesday{Enter}')
    const ask = await screen.findByRole('region', { name: 'Just checking' })
    expect(within(ask).getByText('Today, or next Tuesday?')).toBeInTheDocument()
    await user.type(within(ask).getByLabelText('Your answer'), 'next week{Enter}')
    const card = await screen.findByRole('region', { name: 'Add this task?' })
    expect(within(card).getByLabelText('Due date')).toHaveValue('2026-10-13')
    expect(within(card).getByText('Understood by Claude')).toBeInTheDocument()
    expect(parse).toHaveBeenLastCalledWith('Meeting Tuesday (next week)')
  })

  it('shows why AI was not used when it fell back', async () => {
    const { user } = setup({
      parse: async (text) => ({ source: 'device', note: 'Claude is rate-limited right now; understood on this device instead.', result: { kind: 'task', title: text, due: null, priority: 4, projectName: null, tags: [], recurrence: null, reminderMinutesBefore: null, question: null } }),
    })
    await user.type(screen.getByLabelText('New task'), 'Something{Enter}')
    expect(await screen.findByText(/rate-limited/)).toBeInTheDocument()
  })

  it('labels the demo’s AI as simulated and counts simulated usage', async () => {
    const { user } = setup({ demo: true })
    await user.type(screen.getByLabelText('New task'), 'Pay rent tomorrow{Enter}')
    expect(await screen.findByText(/simulated AI \(no real model\)/)).toBeInTheDocument()
    expect(await screen.findByText(/no real model is called here/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('row', { name: /capture 1/ })).toBeInTheDocument())
  })
})
