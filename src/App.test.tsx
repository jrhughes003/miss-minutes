// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App shell', () => {
  it('starts on Today and switches views from the main navigation', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'All tasks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  it('reports browser storage when there is no Electron bridge', () => {
    render(<App />)
    expect(screen.getByText(/Storage: this browser/)).toBeInTheDocument()
  })
})
