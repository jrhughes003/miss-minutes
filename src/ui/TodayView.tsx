// The screen you open every morning: what's overdue, what's on today (all-day
// and timed, merged with reminders and, from M5, calendar events), and what's
// waiting in the Inbox.

import { useEffect, useId, useMemo, useState } from 'react'
import type { Task } from '../core/tasks/types'
import { toLocalDate } from '../core/time'
import { buildToday, type TimelineItem } from '../core/today'
import { toAppError } from '../storage/api'
import { useClock } from './clock'
import { useApi, useLive } from './data'
import { formatTime } from './format'
import { CaptureBox } from './capture/CaptureBox'
import { TaskEditor } from './tasks/TaskEditor'
import { TaskRow } from './tasks/TaskRow'

/** Re-renders every minute so the "now" line and labels stay current. */
function useNow(): Date {
  const clock = useClock()
  const [now, setNow] = useState(() => clock.now())
  useEffect(() => {
    const id = setInterval(() => setNow(clock.now()), 30_000)
    return () => clearInterval(id)
  }, [clock])
  return now
}

const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

export function TodayView({ onOpenTasks }: { onOpenTasks: () => void }) {
  const api = useApi()
  const clock = useClock()
  const id = useId()
  const now = useNow()
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: tasks = [] } = useLive((a) => a.tasks.list({ status: 'open', includeSubtasks: true }), [], ['tasks'])
  const { data: projects = [] } = useLive((a) => a.projects.list(), [], ['projects'])
  const { data: settings } = useLive((a) => a.settings.get(), [], ['settings'])
  const todayKey = toLocalDate(now, clock.zone())
  const { data: events = [] } = useLive((a) => a.calendar.events(todayKey, todayKey), [todayKey], ['settings', 'calendar'])

  const model = useMemo(
    () => buildToday({ tasks, events, now, zone: clock.zone(), ...(settings ? { allDayTime: settings.allDayReminderTime } : {}) }),
    [tasks, events, now, clock, settings],
  )
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const toggle = (t: Task) => (t.status === 'done' ? api.tasks.reopen(t.id) : api.tasks.complete(t.id)).catch((e: unknown) => setError(toAppError(e).message))
  const row = (t: Task) => (
    <TaskRow key={t.id} task={t} today={model.today} project={t.projectId ? projectById.get(t.projectId) : undefined} selected={openId === t.id} onToggle={toggle} onOpen={(x) => setOpenId(x.id)} />
  )



  const nothingToday = model.allDay.tasks.length === 0 && model.allDay.events.length === 0 && model.timeline.length === 0

  return (
    <div className={`tasks-layout today-layout${openId ? ' has-editor' : ''}`}>
      <section className="task-pane" aria-labelledby={`${id}-h`}>
        <div className="pane-head">
          <h2 id={`${id}-h`}>Today</h2>
          <span className="muted">{longDate.format(new Date(`${model.today}T00:00:00Z`))}</span>
        </div>

        <CaptureBox label="New task for today" placeholder="Add a task for today" defaultDue={{ date: model.today, time: null }} />
        {error && <p className="error-text" role="alert">{error}</p>}

        {model.overdue.length > 0 && (
          <section aria-labelledby={`${id}-od`} className="today-section">
            <h3 id={`${id}-od`} className="overdue-heading">Overdue <span className="count">({model.overdue.length})</span></h3>
            <ul className="task-list">{model.overdue.map(row)}</ul>
          </section>
        )}

        <section aria-labelledby={`${id}-ad`} className="today-section">
          <h3 id={`${id}-ad`}>All day</h3>
          {model.allDay.events.length > 0 && (
            <ul className="event-chips">
              {model.allDay.events.map((e) => (
                <li key={e.id} className="event-chip">
                  <span className="dot" style={{ background: e.color ?? 'var(--p3)' }} aria-hidden="true" />
                  {e.title}
                </li>
              ))}
            </ul>
          )}
          {model.allDay.tasks.length > 0 ? <ul className="task-list">{model.allDay.tasks.map(row)}</ul> : model.allDay.events.length === 0 && <p className="muted">Nothing due today without a time.</p>}
        </section>

        <section aria-labelledby={`${id}-sc`} className="today-section">
          <h3 id={`${id}-sc`}>Schedule</h3>
          {model.timeline.length === 0 ? (
            <p className="muted">{nothingToday ? 'Nothing scheduled today. Add a task above, or give a task a due time.' : 'Nothing at a set time today.'}</p>
          ) : (
            <ol className="timeline">
              {model.timeline.map((item, i) => (
                <TimelineRow key={itemKey(item)} item={item} past={i < model.nowIndex} showNow={i === model.nowIndex} now={now} zoneTime={formatTime} row={row} />
              ))}
              {model.nowIndex === model.timeline.length && <NowLine now={now} />}
            </ol>
          )}
        </section>

        <section aria-labelledby={`${id}-in`} className="today-section">
          <h3 id={`${id}-in`}>Inbox <span className="count">({model.inbox.length})</span></h3>
          {model.inbox.length === 0 ? (
            <p className="muted">Inbox is empty.</p>
          ) : (
            <>
              <ul className="task-list">{model.inbox.slice(0, 5).map(row)}</ul>
              {model.inbox.length > 5 && <p className="muted">and {model.inbox.length - 5} more.</p>}
            </>
          )}
          <p className="muted">
            {model.upcomingCount > 0 ? `${model.upcomingCount} ${model.upcomingCount === 1 ? 'task' : 'tasks'} coming up this week. ` : ''}
            <button type="button" className="link-button" onClick={onOpenTasks}>Open all tasks</button>
          </p>
        </section>
      </section>

      {openId && <TaskEditor taskId={openId} projects={projects} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function itemKey(item: TimelineItem): string {
  if (item.kind === 'event') return `e-${item.event.id}`
  if (item.kind === 'reminder') return `r-${item.ruleId}`
  return `t-${item.task.id}`
}

function NowLine({ now }: { now: Date }) {
  const label = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now)
  return (
    <li className="now-line">
      <span className="time">{label}</span>
      <span className="now-label">Now</span>
    </li>
  )
}

function TimelineRow({ item, past, showNow, now, zoneTime, row }: { item: TimelineItem; past: boolean; showNow: boolean; now: Date; zoneTime: (t: string) => string; row: (t: Task) => React.ReactNode }) {
  return (
    <>
      {showNow && <NowLine now={now} />}
      <li className={`timeline-item kind-${item.kind}${past ? ' is-past' : ''}`}>
        <span className="time">{item.time === '24:00' ? 'midnight' : zoneTime(item.time)}</span>
        <div className="timeline-body">
          {item.kind === 'task' && <ul className="task-list bare">{row(item.task)}</ul>}
          {item.kind === 'reminder' && (
            <p className="reminder-item">
              <span aria-hidden="true">⏰ </span>
              <span className="visually-hidden">Reminder: </span>
              {item.task.title}
            </p>
          )}
          {item.kind === 'event' && (
            <p className="event-item">
              <span className="dot" style={{ background: item.event.color ?? 'var(--p3)' }} aria-hidden="true" />
              {item.event.title}{' '}
              <span className="muted">
                until {item.endTime === '24:00' ? 'midnight' : zoneTime(item.endTime)}
                {item.startedEarlier ? ' (started yesterday)' : ''}
              </span>
            </p>
          )}
        </div>
      </li>
    </>
  )
}
