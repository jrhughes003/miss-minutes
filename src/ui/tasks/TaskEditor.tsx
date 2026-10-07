// Edits one task: every field, plus its subtasks. Changes are saved together
// with "Save", so a half-typed date is never written.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Recurrence } from '../../core/recurrence'
import type { ReminderInput } from '../../core/reminders/types'
import type { Priority, Project, Task } from '../../core/tasks/types'
import { toAppError, type AppError } from '../../storage/api'
import { useToday } from '../clock'
import { useApi, useLive } from '../data'
import { PRIORITY_LABELS } from '../format'
import { ReminderField } from './ReminderField'
import { RepeatField } from './RepeatField'
import { SuggestSteps } from './SuggestSteps'

interface Draft {
  title: string
  notes: string
  dueDate: string
  dueTime: string
  priority: Priority
  projectId: string
  tags: string
  estimate: string
  recurrence: Recurrence | null
  reminders: ReminderInput[]
}

function draftOf(t: Task): Draft {
  return {
    title: t.title,
    notes: t.notes,
    dueDate: t.due?.date ?? '',
    dueTime: t.due?.time ?? '',
    priority: t.priority,
    projectId: t.projectId ?? '',
    tags: t.tags.join(', '),
    estimate: t.estimateMinutes === null ? '' : String(t.estimateMinutes),
    recurrence: t.recurrence,
    reminders: t.reminders.map((r) => ({ id: r.id, when: r.when, phone: r.phone })),
  }
}

export function TaskEditor({ taskId, projects, onClose }: { taskId: string; projects: Project[]; onClose: () => void }) {
  const api = useApi()
  const id = useId()
  const today = useToday()
  const { data: task } = useLive((a) => a.tasks.get(taskId), [taskId], ['tasks'])
  const { data: subtasks = [] } = useLive((a) => a.tasks.subtasks(taskId), [taskId], ['tasks'])
  const { data: google } = useLive((a) => a.google.status(), [], ['calendar'])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newStep, setNewStep] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)

  // Load the form when a different task is opened, and move focus to it.
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (task && loadedFor.current !== task.id) {
      loadedFor.current = task.id
      setDraft(draftOf(task))
      setError(null)
      setConfirmDelete(false)
      heading.current?.focus()
    }
  }, [task])

  if (task === null) {
    return (
      <section className="editor" aria-label="Task details">
        <p>This task no longer exists.</p>
        <button type="button" onClick={onClose}>Close</button>
      </section>
    )
  }
  if (!task || !draft) return <section className="editor" aria-label="Task details" aria-busy="true" />

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft({ ...draft, [key]: value })
    setSaved(false)
  }
  const fieldError = (field: string) => (error?.field === field ? error.message : undefined)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft || !task) return
    setError(null)
    try {
      const tags = draft.tags.split(/[,\s]+/).filter(Boolean)
      await api.tasks.update(task.id, {
        title: draft.title,
        notes: draft.notes,
        due: draft.dueDate ? { date: draft.dueDate, time: draft.dueTime || null } : null,
        priority: draft.priority,
        ...(task.parentId ? {} : { projectId: draft.projectId || null }),
        tags,
        estimateMinutes: draft.estimate ? Number(draft.estimate) : null,
        recurrence: draft.recurrence,
        reminders: draft.reminders,
      })
      setSaved(true)
    } catch (err) {
      setError(toAppError(err))
    }
  }

  async function addStep(e: FormEvent) {
    e.preventDefault()
    if (!newStep.trim() || !task) return
    try {
      await api.tasks.create({ title: newStep, parentId: task.id })
      setNewStep('')
    } catch (err) {
      setError(toAppError(err))
    }
  }

  const toggle = (t: Task) => (t.status === 'done' ? api.tasks.reopen(t.id) : api.tasks.complete(t.id)).catch((err: unknown) => setError(toAppError(err)))

  async function remove() {
    if (!task) return
    await api.tasks.delete(task.id)
    onClose()
  }

  const errorId = (field: string) => (fieldError(field) ? `${id}-${field}-err` : undefined)

  return (
    <section className="editor" aria-labelledby={`${id}-h`}>
      <div className="editor-head">
        <h3 id={`${id}-h`} ref={heading} tabIndex={-1}>{task.parentId ? 'Edit step' : 'Edit task'}</h3>
        <button type="button" className="ghost" onClick={onClose}>Close</button>
      </div>

      <form onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} value={draft.title} onChange={(e) => set('title', e.target.value)} aria-invalid={Boolean(fieldError('title'))} aria-describedby={errorId('title')} />
          {fieldError('title') && <p id={errorId('title')} className="error-text">{fieldError('title')}</p>}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-date`}>Due date</label>
            <input id={`${id}-date`} type="date" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} aria-invalid={Boolean(fieldError('due'))} aria-describedby={errorId('due')} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-time`}>Time <span className="muted">(optional)</span></label>
            <input id={`${id}-time`} type="time" value={draft.dueTime} disabled={!draft.dueDate} onChange={(e) => set('dueTime', e.target.value)} />
          </div>
        </div>
        {fieldError('due') && <p id={errorId('due')} className="error-text">{fieldError('due')}</p>}

        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-prio`}>Priority</label>
            <select id={`${id}-prio`} value={draft.priority} onChange={(e) => set('priority', Number(e.target.value) as Priority)}>
              {([1, 2, 3, 4] as const).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          {!task.parentId && (
            <div className="field">
              <label htmlFor={`${id}-proj`}>Project</label>
              <select id={`${id}-proj`} value={draft.projectId} onChange={(e) => set('projectId', e.target.value)}>
                <option value="">Inbox</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-tags`}>Tags</label>
            <input id={`${id}-tags`} value={draft.tags} onChange={(e) => set('tags', e.target.value)} placeholder="home, errands" aria-invalid={Boolean(fieldError('tags'))} aria-describedby={errorId('tags')} />
            {fieldError('tags') && <p id={errorId('tags')} className="error-text">{fieldError('tags')}</p>}
          </div>
          <div className="field">
            <label htmlFor={`${id}-est`}>Estimate <span className="muted">(min)</span></label>
            <input id={`${id}-est`} type="number" min={1} max={1440} value={draft.estimate} onChange={(e) => set('estimate', e.target.value)} aria-invalid={Boolean(fieldError('estimateMinutes'))} aria-describedby={errorId('estimateMinutes')} />
            {fieldError('estimateMinutes') && <p id={errorId('estimateMinutes')} className="error-text">{fieldError('estimateMinutes')}</p>}
          </div>
        </div>

        {!task.parentId && <RepeatField value={draft.recurrence} onChange={(r) => set('recurrence', r)} error={fieldError('recurrence')} />}

        <ReminderField
          value={draft.reminders}
          onChange={(r) => set('reminders', r)}
          hasDue={Boolean(draft.dueDate)}
          hasTime={Boolean(draft.dueTime)}
          defaultDate={draft.dueDate || today}
          error={fieldError('reminders')}
          phoneAvailable={Boolean(google?.phone.active)}
        />

        <div className="field">
          <label htmlFor={`${id}-notes`}>Notes</label>
          <textarea id={`${id}-notes`} rows={4} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && !error.field && <p className="error-text" role="alert">{error.message}</p>}
        <div className="actions">
          <button type="submit" className="primary">Save</button>
          <span role="status" className="muted">{saved ? 'Saved' : ''}</span>
        </div>
      </form>

      {!task.parentId && (
        <section className="steps" aria-labelledby={`${id}-steps`}>
          <h4 id={`${id}-steps`}>Steps</h4>
          {subtasks.length > 0 && (
            <ul className="step-list">
              {subtasks.map((s) => (
                <li key={s.id} className={s.status === 'done' ? 'is-done' : ''}>
                  <input id={`step-${s.id}`} type="checkbox" checked={s.status === 'done'} onChange={() => toggle(s)} />
                  <label htmlFor={`step-${s.id}`}>{s.title}</label>
                </li>
              ))}
            </ul>
          )}
          <SuggestSteps task={task} />
          <form onSubmit={addStep} className="inline-form">
            <label htmlFor={`${id}-step`} className="visually-hidden">New step</label>
            <input id={`${id}-step`} value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder="Add a step" />
            <button type="submit">Add</button>
          </form>
        </section>
      )}

      <div className="danger-zone">
        {confirmDelete ? (
          <>
            <span>Delete this {task.parentId ? 'step' : 'task'}{subtasks.length ? ' and its steps' : ''}?</span>
            <button type="button" className="danger" onClick={remove}>Yes, delete</button>
            <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="danger-outline" onClick={() => setConfirmDelete(true)}>Delete…</button>
        )}
      </div>
    </section>
  )
}
