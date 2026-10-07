// "Suggest steps" in the task editor (M7). Suggestions are only proposals:
// the user ticks the ones they want, and nothing is added before "Add".

import { useId, useState } from 'react'
import type { Task } from '../../core/tasks/types'
import type { BreakdownResponse } from '../../shared/ai'
import { toAppError } from '../../storage/api'
import { useApi, useLive } from '../data'

const SOURCE: Record<BreakdownResponse['source'], string> = {
  claude: 'Suggested by Claude',
  mock: 'Suggested by simulated AI (no real model)',
  none: '',
}

export function SuggestSteps({ task }: { task: Task }) {
  const api = useApi()
  const id = useId()
  const { data: ai } = useLive((a) => a.ai.status(), [], ['ai'])
  const [includeNotes, setIncludeNotes] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BreakdownResponse | null>(null)
  const [picked, setPicked] = useState<boolean[]>([])
  const [error, setError] = useState<string | null>(null)

  if (!ai?.available) return null

  async function suggest() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.breakdown.suggest(task.id, { includeNotes })
      setResult(r)
      setPicked(r.steps.map(() => true))
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  async function addPicked() {
    if (!result) return
    try {
      for (const [i, step] of result.steps.entries()) if (picked[i]) await api.tasks.create({ title: step, parentId: task.id })
      setResult(null)
    } catch (e) {
      setError(toAppError(e).message)
    }
  }

  return (
    <div className="suggest-steps">
      <div className="inline-form">
        <button type="button" onClick={() => void suggest()} disabled={busy}>{busy ? 'Thinking…' : 'Suggest steps'}</button>
        {task.notes && (
          <label className="check-row">
            <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
            Include notes
          </label>
        )}
      </div>
      <p className="hint">Sends only this task’s title{task.notes && includeNotes ? ', notes' : ''}, project and due date.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {result && result.steps.length === 0 && <p className="hint" role="status">{result.note}</p>}
      {result && result.steps.length > 0 && (
        <fieldset className="suggestions">
          <legend id={`${id}-l`}>Pick the steps to add</legend>
          {result.steps.map((s, i) => (
            <label key={s} className="check-row">
              <input type="checkbox" checked={picked[i] ?? false} onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? e.target.checked : v)))} />
              {s}
            </label>
          ))}
          <div className="actions">
            <button type="button" className="primary" disabled={!picked.some(Boolean)} onClick={() => void addPicked()}>Add selected steps</button>
            <button type="button" onClick={() => setResult(null)}>Discard</button>
            <span className="hint">{SOURCE[result.source]}</span>
          </div>
        </fieldset>
      )}
    </div>
  )
}
