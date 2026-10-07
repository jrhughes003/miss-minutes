// Natural-language capture (M6): type a sentence, see what was understood,
// fix anything, then add. Nothing is saved before you confirm (PLAN.md §4).
//
// A sentence with nothing to understand ("Buy milk") is added at once, the
// same as a plain quick-add. Anything with a date, repeat, priority, tag,
// project or reminder shows an editable preview first, so a misread date is
// caught before it becomes a task on the wrong day.

import { useId, useState, type FormEvent } from 'react'
import type { CaptureResult } from '../../core/capture/types'
import type { Due } from '../../core/recurrence'
import type { CaptureResponse } from '../../shared/ai'
import { toAppError } from '../../storage/api'
import { useApi } from '../data'
import { CapturePreview } from './CapturePreview'

interface Props {
  /** Accessible name of the input. */
  label: string
  placeholder: string
  /** Applied when the sentence names no date (Today: due today). */
  defaultDue?: Due | null
  /** Applied when the sentence names no project (Tasks: the open project). */
  defaultProjectId?: string | null
  submitLabel?: string
}

function nothingUnderstood(r: CaptureResult, text: string): boolean {
  return r.kind === 'task' && !r.due && r.priority === 4 && !r.projectName && r.tags.length === 0 && !r.recurrence && r.reminderMinutesBefore === null && r.title.trim() === text.trim()
}

export function CaptureBox({ label, placeholder, defaultDue = null, defaultProjectId = null, submitLabel = 'Add' }: Props) {
  const api = useApi()
  const id = useId()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ text: string; response: CaptureResponse } | null>(null)

  async function understand(sentence: string) {
    setBusy(true)
    setError(null)
    try {
      const response = await api.capture.parse(sentence)
      if (nothingUnderstood(response.result, sentence) && !response.note) {
        await api.tasks.create({ title: sentence, due: defaultDue, projectId: defaultProjectId })
        setText('')
        setPending(null)
      } else {
        setPending({ text: sentence, response })
      }
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) void understand(text.trim())
  }

  return (
    <div className="capture">
      <form onSubmit={onSubmit} className="quick-add">
        <label htmlFor={`${id}-qa`} className="visually-hidden">{label}</label>
        <input id={`${id}-qa`} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoComplete="off" readOnly={busy} aria-busy={busy} aria-describedby={`${id}-hint`} />
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Reading…' : submitLabel}</button>
      </form>
      <p id={`${id}-hint`} className="hint">Try “Call the dentist Thursday at 3pm p2 #health”.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {pending && (
        <CapturePreview
          key={pending.text}
          text={pending.text}
          response={pending.response}
          defaultDue={defaultDue}
          defaultProjectId={defaultProjectId}
          onRetry={(sentence) => void understand(sentence)}
          onDone={() => {
            setPending(null)
            setText('')
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
