// The editable card shown before a captured task is saved.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Due } from '../../core/recurrence'
import { describeRecurrence } from '../../core/recurrence'
import type { Priority } from '../../core/tasks/types'
import type { CaptureResponse } from '../../shared/ai'
import { toAppError } from '../../storage/api'
import { useApi, useLive } from '../data'
import { PRIORITY_LABELS } from '../format'

const SOURCE_LABEL: Record<CaptureResponse['source'], string> = {
  claude: 'Understood by Claude',
  device: 'Understood on this device',
  mock: 'Understood by simulated AI (no real model)',
}

interface Props {
  text: string
  response: CaptureResponse
  defaultDue: Due | null
  defaultProjectId: string | null
  onRetry: (sentence: string) => void
  onDone: () => void
  onCancel: () => void
}

export function CapturePreview({ text, response, defaultDue, defaultProjectId, onRetry, onDone, onCancel }: Props) {
  const api = useApi()
  const id = useId()
  const { data: projects = [] } = useLive((a) => a.projects.list(), [], ['projects'])
  const r = response.result
  const projectFromText = projects.find((p) => p.name === r.projectName)?.id ?? null
  const due = r.due ?? defaultDue

  const [title, setTitle] = useState(r.title)
  const [date, setDate] = useState(due?.date ?? '')
  const [time, setTime] = useState(due?.time ?? '')
  const [priority, setPriority] = useState<Priority>(r.priority)
  const [projectId, setProjectId] = useState<string>(projectFromText ?? defaultProjectId ?? '')
  const [tags, setTags] = useState(r.tags.join(', '))
  const [repeat, setRepeat] = useState(r.recurrence !== null)
  const [remind, setRemind] = useState(r.reminderMinutesBefore !== null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  // Move focus into the card, so keyboard and screen-reader users land on the result.
  useEffect(() => heading.current?.focus(), [])

  if (r.kind === 'clarify') {
    return (
      <section className="capture-preview" aria-labelledby={`${id}-h`}>
        <h3 id={`${id}-h`} ref={heading} tabIndex={-1}>Just checking</h3>
        <p>{r.question}</p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (answer.trim()) onRetry(`${text} (${answer.trim()})`)
          }}
        >
          <label htmlFor={`${id}-ans`} className="visually-hidden">Your answer</label>
          <input id={`${id}-ans`} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="e.g. next week’s" />
          <button type="submit" className="primary">Try again</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </form>
        <p className="hint">{SOURCE_LABEL[response.source]}</p>
      </section>
    )
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const dueOut = date ? { date, time: time || null } : null
      await api.tasks.create({
        title,
        due: dueOut,
        priority,
        projectId: projectId || null,
        tags: tags.split(/[,\s]+/).filter(Boolean),
        recurrence: repeat && r.recurrence ? { kind: 'rule', rrule: r.recurrence } : null,
        reminders: remind && r.reminderMinutesBefore !== null ? [{ when: { kind: 'beforeDue', minutes: r.reminderMinutesBefore } }] : [],
      })
      onDone()
    } catch (err) {
      setError(toAppError(err).message)
    }
  }

  return (
    <section className="capture-preview" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} ref={heading} tabIndex={-1}>Add this task?</h3>
      {response.note && <p className="hint" role="status">{response.note}</p>}
      <form onSubmit={add}>
        <div className="field">
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-date`}>Due date</label>
            <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-time`}>Time <span className="muted">(optional)</span></label>
            <input id={`${id}-time`} type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-prio`}>Priority</label>
            <select id={`${id}-prio`} value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
              {([1, 2, 3, 4] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-proj`}>Project</label>
            <select id={`${id}-proj`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Inbox</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-tags`}>Tags</label>
            <input id={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
        </div>
        {r.recurrence && (
          <label className="check-row">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            Repeats {describeRecurrence({ kind: 'rule', rrule: r.recurrence })}
          </label>
        )}
        {r.reminderMinutesBefore !== null && (
          <label className="check-row">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            Remind me {r.reminderMinutesBefore === 0 ? 'at the due time' : `${r.reminderMinutesBefore} minutes before`}
          </label>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary">Add task</button>
          <button type="button" onClick={onCancel}>Cancel</button>
          <span className="hint">{SOURCE_LABEL[response.source]}</span>
        </div>
      </form>
    </section>
  )
}
