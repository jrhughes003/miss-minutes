// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { OptimisticToggle } from './OptimisticToggle'

describe('OptimisticToggle', () => {
  it('flips at once, before the save completes', async () => {
    let resolve!: () => void
    const onChange = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    render(<OptimisticToggle checked={false} onChange={onChange}>Thing</OptimisticToggle>)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Thing' }))
    expect(screen.getByRole('checkbox')).toBeChecked() // still saving
    expect(onChange).toHaveBeenCalledWith(true)
    resolve()
  })

  it('reverts and reports when saving fails', async () => {
    const onError = vi.fn()
    render(<OptimisticToggle checked={false} onChange={() => Promise.reject(new Error('nope'))} onError={onError}>Thing</OptimisticToggle>)
    await userEvent.click(screen.getByRole('checkbox'))
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('lets a newer stored value win over a stale click', async () => {
    function Harness() {
      const [stored, setStored] = useState(false)
      return (
        <>
          <OptimisticToggle checked={stored} onChange={() => new Promise(() => {})}>Thing</OptimisticToggle>
          <button onClick={() => setStored(true)}>store true</button>
          <button onClick={() => setStored(false)}>store false</button>
        </>
      )
    }
    render(<Harness />)
    await userEvent.click(screen.getByRole('checkbox')) // pending: true (against stored false)
    await userEvent.click(screen.getByRole('button', { name: 'store true' }))
    await userEvent.click(screen.getByRole('button', { name: 'store false' })) // stored changed: the old click is stale
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})
