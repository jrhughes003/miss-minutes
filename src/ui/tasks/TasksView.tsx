import { useId, useMemo, useState, type FormEvent } from 'react'
import type { Project, Task } from '../../core/tasks/types'
import { toAppError, type AppError } from '../../storage/api'
import { useToday } from '../clock'
import { useApi, useLive } from '../data'
import { TaskEditor } from './TaskEditor'
import { TaskRow } from './TaskRow'

type ListSel = { kind: 'all' } | { kind: 'inbox' } | { kind: 'project'; id: string }

export function TasksView() {
  const api = useApi()
  const today = useToday()
  const id = useId()
  const [list, setList] = useState<ListSel>({ kind: 'all' })
  const [showDone, setShowDone] = useState(false)
  const [tag, setTag] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<AppError | null>(null)
  const [newProject, setNewProject] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false)

  const { data: projects = [] } = useLive((a) => a.projects.list(), [], ['projects'])
  const { data: tags = [] } = useLive((a) => a.tags.list(), [], ['tasks'])
  const projectId = list.kind === 'all' ? undefined : list.kind === 'inbox' ? null : list.id
  const { data: tasks = [] } = useLive(
    (a) => a.tasks.list({ status: showDone ? 'all' : 'open', ...(projectId !== undefined ? { projectId } : {}), ...(tag ? { tag } : {}) }),
    [projectId, showDone, tag],
  )
  const { data: allSubtasks = [] } = useLive((a) => a.tasks.list({ status: 'all', includeSubtasks: true }), [], ['tasks'])

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const stepCounts = useMemo(() => {
    const m = new Map<string, { open: number; total: number }>()
    for (const t of allSubtasks) {
      if (!t.parentId) continue
      const c = m.get(t.parentId) ?? { open: 0, total: 0 }
      c.total++
      if (t.status === 'open') c.open++
      m.set(t.parentId, c)
    }
    return m
  }, [allSubtasks])

  const currentProject = list.kind === 'project' ? byId.get(list.id) : undefined
  const listName = list.kind === 'all' ? 'All tasks' : list.kind === 'inbox' ? 'Inbox' : (currentProject?.name ?? 'Project')
  const report = (e: unknown) => setError(toAppError(e))

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setError(null)
    try {
      await api.tasks.create({ title, projectId: list.kind === 'project' ? list.id : null })
      setTitle('')
    } catch (err) {
      report(err)
    }
  }

  async function addProject(e: FormEvent) {
    e.preventDefault()
    if (!newProject.trim()) return
    try {
      const p = await api.projects.create(newProject)
      setNewProject('')
      setList({ kind: 'project', id: p.id })
    } catch (err) {
      report(err)
    }
  }

  const toggle = (t: Task) => (t.status === 'done' ? api.tasks.reopen(t.id) : api.tasks.complete(t.id)).catch(report)

  const select = (sel: ListSel) => {
    setList(sel)
    setConfirmDeleteProject(false)
    setRenaming(null)
  }

  return (
    <div className={`tasks-layout${openId ? ' has-editor' : ''}`}>
      <nav className="lists" aria-label="Task lists">
        <ul>
          <ListButton label="All tasks" active={list.kind === 'all'} onClick={() => select({ kind: 'all' })} />
          <ListButton label="Inbox" active={list.kind === 'inbox'} onClick={() => select({ kind: 'inbox' })} />
        </ul>
        <h3 className="lists-heading">Projects</h3>
        <ul>
          {projects.map((p) => (
            <ListButton key={p.id} label={p.name} color={p.color} active={list.kind === 'project' && list.id === p.id} onClick={() => select({ kind: 'project', id: p.id })} />
          ))}
        </ul>
        <form onSubmit={addProject} className="inline-form">
          <label htmlFor={`${id}-np`} className="visually-hidden">New project name</label>
          <input id={`${id}-np`} value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="New project" />
          <button type="submit">Add</button>
        </form>
      </nav>

      <section className="task-pane" aria-labelledby={`${id}-h`}>
        <div className="pane-head">
          {renaming !== null && currentProject ? (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault()
                api.projects.rename(currentProject.id, renaming).then(() => setRenaming(null), report)
              }}
            >
              <label htmlFor={`${id}-rn`} className="visually-hidden">Project name</label>
              <input id={`${id}-rn`} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
              <button type="submit">Rename</button>
              <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          ) : (
            <h2 id={`${id}-h`}>{listName}</h2>
          )}
          {currentProject && renaming === null && (
            <div className="pane-actions">
              <button type="button" className="ghost" onClick={() => setRenaming(currentProject.name)}>Rename</button>
              {confirmDeleteProject ? (
                <>
                  <span className="muted">Tasks move to the Inbox.</span>
                  <button type="button" className="danger" onClick={() => api.projects.delete(currentProject.id).then(() => select({ kind: 'inbox' }), report)}>
                    Delete project
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteProject(false)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="ghost" onClick={() => setConfirmDeleteProject(true)}>Delete…</button>
              )}
            </div>
          )}
        </div>

        <form onSubmit={add} className="quick-add">
          <label htmlFor={`${id}-qa`} className="visually-hidden">New task</label>
          <input id={`${id}-qa`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Add a task to ${listName === 'All tasks' ? 'the Inbox' : listName}`} autoComplete="off" />
          <button type="submit" className="primary">Add task</button>
        </form>
        {error && <p className="error-text" role="alert">{error.message}</p>}

        <div className="filters">
          <label>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
          </label>
          {tags.length > 0 && (
            <label>
              Tag{' '}
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Any</option>
                {tags.map((t) => (
                  <option key={t} value={t}>#{t}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {tasks.length === 0 ? (
          <p className="empty muted">{showDone || tag ? 'No tasks match.' : 'Nothing to do here. Add a task above.'}</p>
        ) : (
          <ul className="task-list" aria-label={`${listName}: ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}>
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                today={today}
                project={list.kind === 'all' && t.projectId ? byId.get(t.projectId) : undefined}
                subtaskCount={stepCounts.get(t.id)}
                selected={openId === t.id}
                onToggle={toggle}
                onOpen={(task) => setOpenId(task.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {openId && <TaskEditor taskId={openId} projects={projects} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function ListButton({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: Project['color'] }) {
  return (
    <li>
      <button type="button" className="list-button" aria-current={active ? 'true' : undefined} onClick={onClick}>
        {color && <span className="dot" style={{ background: color }} aria-hidden="true" />}
        {label}
      </button>
    </li>
  )
}
