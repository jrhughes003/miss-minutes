import type { Project, Task } from '../../core/tasks/types'
import { describeRecurrence } from '../../core/recurrence'
import { dueState, formatDue } from '../format'

interface Props {
  task: Task
  today: string
  project: Project | undefined
  subtaskCount?: { open: number; total: number } | undefined
  selected: boolean
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
}

export function TaskRow({ task, today, project, subtaskCount, selected, onToggle, onOpen }: Props) {
  const done = task.status === 'done'
  const checkboxId = `done-${task.id}`
  return (
    <li className={`task-row${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`} data-priority={task.priority}>
      <input
        id={checkboxId}
        type="checkbox"
        className="task-check"
        checked={done}
        onChange={() => onToggle(task)}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
      />
      <div className="task-main">
        <button type="button" className="task-title" onClick={() => onOpen(task)} aria-pressed={selected}>
          {task.title}
        </button>
        <div className="task-meta">
          {task.priority < 4 && <span className={`chip prio-${task.priority}`}>P{task.priority}</span>}
          {task.due && (
            <span className={`chip due-${dueState(task.due, today)}`}>
              {dueState(task.due, today) === 'overdue' && <span className="visually-hidden">Overdue: </span>}
              {formatDue(task.due, today)}
            </span>
          )}
          {task.recurrence && (
            <span className="chip" title={describeRecurrence(task.recurrence)}>
              <span aria-hidden="true">↻</span>
              <span className="visually-hidden">Repeats {describeRecurrence(task.recurrence)}</span>
            </span>
          )}
          {subtaskCount && subtaskCount.total > 0 && (
            <span className="chip">
              {subtaskCount.total - subtaskCount.open}/{subtaskCount.total} steps
            </span>
          )}
          {project && (
            <span className="chip project-chip">
              <span className="dot" style={{ background: project.color }} aria-hidden="true" />
              {project.name}
            </span>
          )}
          {task.tags.map((t) => (
            <span key={t} className="chip tag">#{t}</span>
          ))}
        </div>
      </div>
    </li>
  )
}
