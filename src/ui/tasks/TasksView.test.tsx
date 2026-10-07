// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../../core/clock'
import { createLocalApi, type DataApi } from '../../storage/api'
import { memoryStorage } from '../../storage/localRepo'
import { ClockProvider } from '../clock'
import { DataProvider } from '../data'
import { TasksView } from './TasksView'

let api: DataApi
const clock = new FakeClock('2026-10-06T14:00:00Z', 'America/Toronto') // Tuesday 10:00 local

function renderView() {
  let n = 0
  api = createLocalApi(memoryStorage(), { clock, newId: () => `id${++n}` })
  const user = userEvent.setup()
  render(
    <ClockProvider clock={clock}>
      <DataProvider api={api}>
        <TasksView />
      </DataProvider>
    </ClockProvider>,
  )
  return user
}

const taskList = () => screen.findByRole('list', { name: /tasks?$/ })
const editor = () => screen.findByRole('region', { name: /Edit (task|step)/ })

beforeEach(() => clock.set('2026-10-06T14:00:00Z'))

describe('TasksView', () => {
  it('adds a task from the quick-add box and shows it in the list', async () => {
    const user = renderView()
    expect(await screen.findByText(/Nothing to do here/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('New task'), 'Call the dentist{Enter}')
    const list = await taskList()
    expect(within(list).getByRole('button', { name: 'Call the dentist' })).toBeInTheDocument()
    expect(screen.getByLabelText('New task')).toHaveValue('')
  })

  it('completes a task with its checkbox, and can show it again as completed', async () => {
    const user = renderView()
    await api.tasks.create({ title: 'Buy milk' })
    await user.click(await screen.findByRole('checkbox', { name: 'Complete "Buy milk"' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Buy milk' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('checkbox', { name: 'Show completed' }))
    expect(await screen.findByRole('checkbox', { name: 'Mark "Buy milk" as not done' })).toBeChecked()
  })

  it('edits a task’s due date, time and priority, and shows them in the row', async () => {
    const user = renderView()
    await api.tasks.create({ title: 'Report' })
    await user.click(await screen.findByRole('button', { name: 'Report' }))
    const panel = await editor()
    await user.type(within(panel).getByLabelText('Due date'), '2026-10-07')
    await user.type(within(panel).getByLabelText(/^Time/), '13:30')
    await user.selectOptions(within(panel).getByLabelText('Priority'), '1')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))
    expect(await within(panel).findByText('Saved')).toBeInTheDocument()
    const list = await taskList()
    expect(within(list).getByText('P1')).toBeInTheDocument()
    expect(within(list).getByText(/^Tomorrow 1:30/)).toBeInTheDocument()
  })

  it('shows a validation error next to the field that caused it', async () => {
    const user = renderView()
    await api.tasks.create({ title: 'Tagged' })
    await user.click(await screen.findByRole('button', { name: 'Tagged' }))
    const panel = await editor()
    await user.type(within(panel).getByLabelText('Tags'), 'not/allowed')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))
    expect(await within(panel).findByText(/may only contain letters/)).toBeInTheDocument()
    expect(within(panel).getByLabelText('Tags')).toHaveAttribute('aria-invalid', 'true')
  })

  it('marks overdue tasks for screen readers as well as visually', async () => {
    renderView()
    await api.tasks.create({ title: 'Late', due: { date: '2026-10-01', time: null } })
    expect(await screen.findByText('Overdue:')).toHaveClass('visually-hidden')
  })

  it('creates a project, files new tasks into it, and deletes it into the Inbox', async () => {
    const user = renderView()
    await user.type(screen.getByLabelText('New project name'), 'Garden{Enter}')
    expect(await screen.findByRole('heading', { level: 2, name: 'Garden' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('New task'), 'Rake leaves{Enter}')
    expect(await screen.findByRole('button', { name: 'Rake leaves' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete…' }))
    await user.click(screen.getByRole('button', { name: 'Delete project' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Inbox' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Rake leaves' })).toBeInTheDocument()
  })

  it('adds steps to a task and counts them in the row', async () => {
    const user = renderView()
    await api.tasks.create({ title: 'Move house' })
    await user.click(await screen.findByRole('button', { name: 'Move house' }))
    const panel = await editor()
    await user.type(within(panel).getByLabelText('New step'), 'Book van{Enter}')
    await user.type(within(panel).getByLabelText('New step'), 'Pack books{Enter}')
    await user.click(await within(panel).findByRole('checkbox', { name: 'Book van' }))
    const list = await taskList()
    expect(await within(list).findByText('1/2 steps')).toBeInTheDocument()
  })

  it('makes a task repeat, and completing it schedules the next one', async () => {
    const user = renderView()
    await api.tasks.create({ title: 'Water plants', due: { date: '2026-10-06', time: null } })
    await user.click(await screen.findByRole('button', { name: 'Water plants' }))
    const panel = await editor()
    await user.selectOptions(within(panel).getByLabelText('Repeat'), 'Every week')
    expect(within(panel).getByText('Repeats every week.')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Save' }))
    await within(panel).findByText('Saved')

    await user.click(screen.getByRole('checkbox', { name: 'Complete "Water plants"' }))
    const list = await taskList()
    expect(await within(list).findByText('Oct 13')).toBeInTheDocument()
  })

  it('deletes a task after confirmation', async () => {
    const user = renderView()
    await api.tasks.create({ title: 'Mistake' })
    await user.click(await screen.findByRole('button', { name: 'Mistake' }))
    await user.click(within(await editor()).getByRole('button', { name: 'Delete…' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mistake' })).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: /Edit task/ })).not.toBeInTheDocument()
  })
})
