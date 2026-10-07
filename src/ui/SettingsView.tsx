import { useId, useState, type FormEvent } from 'react'
import { toAppError } from '../storage/api'
import { storageMode } from '../storage/runtime'
import { useApi, useLive } from './data'
import { GoogleSettings } from './GoogleSettings'

export function SettingsView() {
  const api = useApi()
  const id = useId()
  const { data: settings } = useLive((a) => a.settings.get(), [], ['settings'])
  const [error, setError] = useState<string | null>(null)

  if (!settings) return <h2>Settings</h2>

  return (
    <>
      <h2>Settings</h2>
      <section className="settings-section" aria-labelledby={`${id}-rem`}>
        <h3 id={`${id}-rem`}>Reminders</h3>
        {/* Keyed by the saved value, so the field resets when the setting changes elsewhere. */}
        <TimeForm key={settings.allDayReminderTime} initial={settings.allDayReminderTime} onError={setError} />
        {error && <p className="error-text" role="alert">{error}</p>}
        {storageMode === 'localStorage' && (
          <p className="hint">In the browser demo, reminders only fire while this tab is open. The desktop app runs them in the background.</p>
        )}
      </section>

      <GoogleSettings />

      {storageMode === 'sqlite' && (
        <section className="settings-section" aria-labelledby={`${id}-app`}>
          <h3 id={`${id}-app`}>App</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.startAtLogin}
              onChange={(e) => api.settings.set({ startAtLogin: e.target.checked }).catch((err: unknown) => setError(toAppError(err).message))}
            />
            Start Miss Minutes when I sign in to Windows (hidden in the tray)
          </label>
          <p className="hint">Closing the window keeps Miss Minutes running in the tray so reminders still fire. Use Quit in the tray menu to stop it.</p>
        </section>
      )}
    </>
  )
}

function TimeForm({ initial, onError }: { initial: string; onError: (message: string | null) => void }) {
  const api = useApi()
  const id = useId()
  const [time, setTime] = useState(initial)
  const [status, setStatus] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      await api.settings.set({ allDayReminderTime: time })
      onError(null)
      setStatus('Saved')
    } catch (err) {
      onError(toAppError(err).message)
    }
  }

  return (
    <>
      <form onSubmit={save} className="inline-form settings-row">
        <label htmlFor={`${id}-time`}>All-day reminder time</label>
        <input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-describedby={`${id}-time-hint`} className="narrow-time" />
        <button type="submit">Save</button>
        <span role="status" className="muted">{status}</span>
      </form>
      <p id={`${id}-time-hint`} className="hint">
        Reminders on tasks without a time count back from this, and "snooze until tomorrow" ends at it.
      </p>
    </>
  )
}
