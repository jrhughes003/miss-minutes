// Fired reminders waiting for an answer: Done, Snooze or Dismiss. Clicking a
// notification brings the window forward with this bar on top. On Windows,
// Electron notifications can't carry their own buttons (D14).

import { useEffect, useRef, useState } from 'react'
import type { ActiveReminder, SnoozeChoice } from '../core/reminders/types'
import { toAppError } from '../storage/api'
import { useApi, useLive } from './data'

const SNOOZES: { label: string; choice: SnoozeChoice }[] = [
  { label: '10 min', choice: { kind: 'minutes', minutes: 10 } },
  { label: '1 hour', choice: { kind: 'minutes', minutes: 60 } },
  { label: 'Tomorrow', choice: { kind: 'tomorrow' } },
]

export function ActiveReminders() {
  const api = useApi()
  const { data: active = [] } = useLive((a) => a.reminders.active(), [], ['reminders', 'tasks'])
  const [error, setError] = useState<string | null>(null)
  const region = useRef<HTMLElement>(null)

  // A clicked notification focuses the bar, so keyboard users land on it.
  useEffect(() => api.onReminderOpen(() => region.current?.focus()), [api])

  if (active.length === 0) return null

  const act = (r: ActiveReminder, action: Parameters<typeof api.reminders.act>[2]) =>
    api.reminders.act(r.ruleId, r.occurrenceLocal, action).then(
      () => setError(null),
      (e: unknown) => setError(toAppError(e).message),
    )

  return (
    <section className="active-reminders" aria-label="Due reminders" ref={region} tabIndex={-1}>
      <ul>
        {active.map((r) => (
          <li key={`${r.ruleId}|${r.occurrenceLocal}`}>
            <span className="reminder-title">
              <span aria-hidden="true">⏰ </span>
              {r.late && <span className="late">Missed: </span>}
              {r.title}
            </span>
            <span className="reminder-actions">
              <button type="button" className="primary" onClick={() => act(r, { kind: 'done' })} aria-label={`Done: ${r.title}`}>
                Done
              </button>
              {SNOOZES.map((s) => (
                <button key={s.label} type="button" onClick={() => act(r, { kind: 'snooze', choice: s.choice })} aria-label={`Snooze "${r.title}" ${s.label === 'Tomorrow' ? 'until tomorrow' : `for ${s.label}`}`}>
                  {s.label}
                </button>
              ))}
              <button type="button" className="ghost" onClick={() => act(r, { kind: 'dismiss' })} aria-label={`Dismiss: ${r.title}`}>
                Dismiss
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  )
}
