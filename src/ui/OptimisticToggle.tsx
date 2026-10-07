// A checkbox for a setting that lives in the main process.
//
// Without this, the box would only change after the round trip (click → IPC
// → save → change event → refetch), so for a moment a click looks ignored.
// It shows the clicked value at once and reverts if saving fails.
//
// Once the stored value changes, for any reason, the pending click is
// dropped and the stored value wins, so a stale click can never override newer
// state, even if the stored value later changes back.

import { useState, type ReactNode } from 'react'

interface Props {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => Promise<unknown>
  onError?: (e: unknown) => void
  children: ReactNode
  className?: string
}

export function OptimisticToggle({ checked, disabled, onChange, onError, children, className = 'check-row' }: Props) {
  const [pending, setPending] = useState<boolean | null>(null)
  // React's "adjust state when a prop changes" pattern: compare during render
  // instead of in an effect, so there is no flash of the stale value.
  const [seen, setSeen] = useState(checked)
  if (seen !== checked) {
    setSeen(checked)
    setPending(null)
  }
  const shown = pending ?? checked

  return (
    <label className={className}>
      <input
        type="checkbox"
        checked={shown}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.checked
          setPending(next)
          onChange(next).catch((err: unknown) => {
            setPending(null)
            onError?.(err)
          })
        }}
      />
      {children}
    </label>
  )
}
