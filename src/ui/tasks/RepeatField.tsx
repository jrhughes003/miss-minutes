// Chooses how a task repeats: a preset, "N days/weeks/months after
// completion", or a custom RRULE for anything else.

import { useId } from 'react'
import { describeRecurrence, RECURRENCE_PRESETS, validateRecurrence, type Recurrence } from '../../core/recurrence'

type Mode = 'none' | `preset:${number}` | 'after' | 'custom'

function modeOf(r: Recurrence | null): Mode {
  if (!r) return 'none'
  if (r.kind === 'afterCompletion') return 'after'
  const i = RECURRENCE_PRESETS.findIndex((p) => p.recurrence.kind === 'rule' && p.recurrence.rrule === r.rrule)
  return i >= 0 ? `preset:${i}` : 'custom'
}

export function RepeatField({ value, onChange, error }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void; error?: string | undefined }) {
  const id = useId()
  const mode = modeOf(value)
  const problem = value ? validateRecurrence(value) : null

  const setMode = (m: Mode) => {
    if (m === 'none') onChange(null)
    else if (m === 'after') onChange({ kind: 'afterCompletion', every: 1, unit: 'week' })
    else if (m === 'custom') onChange({ kind: 'rule', rrule: value?.kind === 'rule' ? value.rrule : 'FREQ=WEEKLY;BYDAY=MO' })
    else onChange(RECURRENCE_PRESETS[Number(m.slice(7))]!.recurrence)
  }

  return (
    <fieldset className="field repeat-field">
      <legend>Repeat</legend>
      <label htmlFor={`${id}-mode`} className="visually-hidden">Repeat</label>
      <select id={`${id}-mode`} value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-describedby={`${id}-desc`}>
        <option value="none">Doesn’t repeat</option>
        {RECURRENCE_PRESETS.map((p, i) => (
          <option key={p.label} value={`preset:${i}`}>{p.label}</option>
        ))}
        <option value="after">Some time after I finish…</option>
        <option value="custom">Custom rule…</option>
      </select>

      {value?.kind === 'afterCompletion' && (
        <div className="inline-fields">
          <label htmlFor={`${id}-every`}>Every</label>
          <input
            id={`${id}-every`}
            type="number"
            min={1}
            max={365}
            value={value.every}
            onChange={(e) => onChange({ ...value, every: Number(e.target.value) })}
            className="narrow"
          />
          <label htmlFor={`${id}-unit`} className="visually-hidden">Unit</label>
          <select id={`${id}-unit`} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as 'day' | 'week' | 'month' })}>
            <option value="day">days</option>
            <option value="week">weeks</option>
            <option value="month">months</option>
          </select>
          <span>after completion</span>
        </div>
      )}

      {value?.kind === 'rule' && mode === 'custom' && (
        <div className="field">
          <label htmlFor={`${id}-rule`}>iCalendar rule</label>
          <input
            id={`${id}-rule`}
            value={value.rrule}
            onChange={(e) => onChange({ kind: 'rule', rrule: e.target.value })}
            spellCheck={false}
            aria-invalid={Boolean(problem)}
          />
        </div>
      )}

      <p id={`${id}-desc`} className={`hint${problem || error ? ' error-text' : ''}`} role={problem || error ? 'alert' : undefined}>
        {error ?? problem ?? (value ? `Repeats ${describeRecurrence(value)}.` : '')}
      </p>
    </fieldset>
  )
}
