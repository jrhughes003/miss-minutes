// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../core/clock'
import { createLocalApi } from '../../storage/api'
import { memoryStorage } from '../../storage/localRepo'
import { ClockProvider } from '../clock'
import { DataProvider } from '../data'
import { TasksView } from './TasksView'

async function setup(demo: boolean) {
  const clock = new FakeClock('2026-10-06T14:00:00Z')
  let n = 0
  const api = createLocalApi(memoryStorage(), { clock, newId: () => `id${++n}`, demo })
  await api.tasks.create({ title: 'Plan the move', notes: 'Two bedrooms' })
  const user = userEvent.setup()
  render(
    <ClockProvider clock={clock}>
      <DataProvider api={api}>
        <TasksView />
      </DataProvider>
    </ClockProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'Plan the move' }))
  return { api, user, editor: await screen.findByRole('region', { name: 'Edit task' }) }
}

describe('Suggest steps', () => {
  it('offers suggestions to pick from, labelled, and adds only the ones kept', async () => {
    const { api, user, editor } = await setup(true)
    await user.click(await within(editor).findByRole('button', { name: 'Suggest steps' }))
    const box = await within(editor).findByRole('group', { name: 'Pick the steps to add' })
    expect(within(box).getByText('Suggested by simulated AI (no real model)')).toBeInTheDocument()
    const boxes = within(box).getAllByRole('checkbox')
    expect(boxes).toHaveLength(4)
    await user.click(boxes[1]!) // untick one
    await user.click(within(box).getByRole('button', { name: 'Add selected steps' }))
    await waitFor(async () => expect(await api.tasks.subtasks('id1')).toHaveLength(3))
  })

  it('says what is sent, including notes only when ticked', async () => {
    const { user, editor } = await setup(true)
    expect(await within(editor).findByText(/title, notes, project and due date/)).toBeInTheDocument()
    await user.click(within(editor).getByRole('checkbox', { name: 'Include notes' }))
    expect(within(editor).getByText(/title, project and due date/)).toBeInTheDocument()
  })

  it('is hidden where AI isn’t available (plain web build)', async () => {
    const { editor } = await setup(false)
    expect(within(editor).queryByRole('button', { name: 'Suggest steps' })).not.toBeInTheDocument()
  })
})
