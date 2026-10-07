// Edits a task's reminders: "N minutes before due" presets, or a fixed date
// and time.

import { useId, useState } from 'react'
import { describeReminder, REMINDER_LIMITS, REMINDER_PRESETS } from '../../core/reminders/rules'
import type { ReminderInput } from '../../core/reminders/types'
import { isLocalDate, isLocalTime } from '../../core/time'
import { bridge } from '../../storage/runtime'

interface Props {
  value: ReminderInput[]
  onChange: (next: ReminderInput[]) => void
  hasDue: boolean
  hasTime: boolean
  defaultDate: string
  error?: string | undefined
  /** Phone reminders are set up (desktop, Google connected, permitted). */
  phoneAvailable?: boolean
}

/** In the browser, ask for notification permission the first time a reminder is added (a user gesture), never on page load. */
function askBrowserPermission() {
  if (bridge || typeof Notification === 'undefined') return
  if (Notification.permission === 'default') void Notification.requestPermission()
}

export function ReminderField({ value, onChange, hasDue, hasTime, defaultDate, error, phoneAvailable = false }: Props) {
  const id = useId()
  const [choice, setChoice] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState('09:00')
  const full = value.length >= REMINDER_LIMITS.perTask

  const add = (r: ReminderInput) => {
    askBrowserPermission()
    onChange([...value, r])
    setChoice('')
  }

  const onSelect = (v: string) => {
    if (v === 'at') {
      setChoice('at')
      return
    }
    if (v) add({ when: { kind: 'beforeDue', minutes: Number(v) } })
  }

  return (
    <fieldset className="field reminder-field">
      <legend>Reminders</legend>
      {value.length > 0 && (
        <ul className="reminder-list">
          {value.map((r, i) => (
            <li key={r.id ?? `new-${i}`}>
              <span>{describeReminder(r, hasTime)}</span>
              {phoneAvailable && (
                <label className="check-row phone-toggle">
                  <input type="checkbox" checked={Boolean(r.phone)} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, phone: e.target.checked } : x)))} />
                  <span aria-hidden="true">📱</span>
                  <span className="visually-hidden">Also on my phone: {describeReminder(r, hasTime)}</span>
                </label>
              )}
              <button type="button" className="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove reminder: ${describeReminder(r, hasTime)}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <>
          <label htmlFor={`${id}-add`} className="visually-hidden">Add a reminder</label>
          <select id={`${id}-add`} value={choice} onChange={(e) => onSelect(e.target.value)}>
            <option value="">Add a reminder…</option>
            {REMINDER_PRESETS.map((p) => (
              <option key={p.minutes} value={p.minutes} disabled={!hasDue}>
                {hasTime || p.minutes !== 0 ? p.label : 'On the day'}
                {hasDue ? '' : ' (needs a due date)'}
              </option>
            ))}
            <option value="at">At a specific time…</option>
          </select>
        </>
      )}
      {choice === 'at' && (
        <div className="inline-fields">
          <label htmlFor={`${id}-date`} className="visually-hidden">Reminder date</label>
          <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label htmlFor={`${id}-time`} className="visually-hidden">Reminder time</label>
          <input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button type="button" disabled={!isLocalDate(date) || !isLocalTime(time)} onClick={() => add({ when: { kind: 'at', date, time } })}>
            Add reminder
          </button>
          <button type="button" className="ghost" onClick={() => setChoice('')}>Cancel</button>
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!hasTime && hasDue && value.some((r) => r.when.kind === 'beforeDue') && (
        <p className="hint">All-day tasks remind from the time set in Settings.</p>
      )}
    </fieldset>
  )
}
