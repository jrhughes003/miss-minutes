// Plan my day: brain dump → lay it out on the day → confirm.
//
// 1. Write what you need to do (one per line; "1h", "30m" set the length,
//    "p1"/"#tag" work as elsewhere), and tick tasks already due that day.
// 2. Everything is arranged around your calendar automatically; drag,
//    resize or use the keyboard to adjust. Problems show live, in red.
// 3. Confirm: tasks get their times (with a reminder), and if you like, the
//    blocks go onto a Google calendar you own. One click undoes it all.

import { useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { parseBaseline } from '../../core/capture/baseline'
import { autoArrange, checkBoard, newItem, nudge, place, placeOne, resize, unplace, type BoardItem } from '../../core/plan/board'
import { busyFromEvents } from '../../core/plan/apply'
import { parseEstimate } from '../../core/plan/estimate'
import { windowOf } from '../../core/plan/slots'
import { DEFAULT_PLAN_WINDOW, type PlanDay } from '../../core/plan/types'
import { addDays, toLocalDate, toLocalDateTime } from '../../core/time'
import { toAppError } from '../../storage/api'
import { useClock, useToday } from '../clock'
import { useApi, useLive } from '../data'
import { DayGrid } from './DayGrid'

const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const REMINDER_MINUTES = 5

export function PlanView() {
  const api = useApi()
  const clock = useClock()
  const today = useToday()
  const id = useId()
  const [date, setDate] = useState(() => addDays(today, 1))
  const [dump, setDump] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [items, setItems] = useState<BoardItem[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [remind, setRemind] = useState(true)
  const [blocks, setBlocks] = useState(true)
  const [calendarId, setCalendarId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [windowStart, setWindowStart] = useState<string>(DEFAULT_PLAN_WINDOW.start)
  const [windowEnd, setWindowEnd] = useState<string>(DEFAULT_PLAN_WINDOW.end)
  const [buffer, setBuffer] = useState(10)
  const gridRef = useRef<HTMLDivElement>(null)

  const zone = clock.zone()
  const { data: events = [] } = useLive((a) => a.calendar.events(date, date), [date], ['calendar'])
  const { data: candidates = [] } = useLive((a) => a.tasks.list({ status: 'open' }), [], ['tasks'])
  const { data: google } = useLive((a) => a.google.status(), [], ['calendar'])
  const { data: latest } = useLive((a) => a.plan.latest(), [], ['plan'])

  const dueThatDay = candidates.filter((t) => t.due && t.due.date <= date && !t.due.time)
  const timed = events.filter((e) => !e.allDay) as Extract<(typeof events)[number], { allDay: false }>[]
  const allDay = events.filter((e) => e.allDay)
  const day: PlanDay = useMemo(
    () => ({
      date,
      zone,
      window: windowStart < windowEnd ? { start: windowStart, end: windowEnd } : DEFAULT_PLAN_WINDOW,
      busy: busyFromEvents(events),
      notBefore: date === toLocalDate(clock.now(), zone) ? clock.now().toISOString() : null,
    }),
    [date, zone, events, clock, windowStart, windowEnd],
  )
  const problems = useMemo(() => (items ? checkBoard(items, day) : new Map()), [items, day])
  const ownCalendars = google?.blocks.calendars ?? []
  const chosenCalendar = calendarId || ownCalendars.find((c) => c.primary)?.id || ownCalendars[0]?.id || ''

  function layOut() {
    setError(null)
    const fromDump = dump
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => {
        const { minutes, rest } = parseEstimate(line)
        const p = parseBaseline(rest, { nowLocal: toLocalDateTime(clock.now(), zone), zone, projectNames: [], tagNames: [] })
        return newItem(`new-${i}`, p.title || rest, minutes, { priority: p.priority, tags: p.tags })
      })
    const fromTasks = dueThatDay
      .filter((t) => picked.has(t.id))
      .map((t) => newItem(t.id, t.title, t.estimateMinutes, { taskId: t.id, priority: t.priority, dueDate: t.due?.date ?? null, tags: t.tags }))
    const all = [...fromTasks, ...fromDump]
    if (all.length === 0) {
      setError('Write at least one thing to do, or tick a task.')
      return
    }
    setItems(autoArrange(all, day, buffer))
  }

  // Tray items can be dragged onto the grid. The item captures the pointer so
  // the release reaches it wherever it happens; presses on its buttons aren't drags.
  const trayDrag = useRef<{ key: string; x: number; y: number } | null>(null)
  const onTrayPointerDown = (e: PointerEvent<HTMLElement>, key: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    trayDrag.current = { key, x: e.clientX, y: e.clientY }
  }
  const onTrayPointerUp = (e: PointerEvent<HTMLElement>) => {
    const drag = trayDrag.current
    trayDrag.current = null
    const grid = gridRef.current
    if (!drag || !grid || !items) return
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) return // a click, not a drag
    const key = drag.key
    const r = grid.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
    const start = Date.parse(windowOf(day).start) + ((e.clientY - r.top) / 1.1) * 60_000
    setItems(place(items, key, new Date(start).toISOString()))
  }

  async function confirm() {
    if (!items) return
    setBusy(true)
    setError(null)
    try {
      await api.plan.apply({
        date,
        items: items.filter((i) => i.start).map((i) => ({ key: i.key, taskId: i.taskId, title: i.title, minutes: i.minutes, start: i.start!, priority: i.priority, tags: i.tags })),
        reminderMinutesBefore: remind ? REMINDER_MINUTES : null,
        calendarId: blocks && google?.blocks.scopeGranted && chosenCalendar ? chosenCalendar : null,
        window: day.window,
      })
      setItems(null)
      setDump('')
      setPicked(new Set())
      setConfirming(false)
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const placedCount = items?.filter((i) => i.start).length ?? 0
  const tray = items?.filter((i) => !i.start) ?? []
  const hasProblems = problems.size > 0
  const canBlock = Boolean(google?.connected)

  return (
    <div className="plan-view">
      <div className="pane-head">
        <h2>Plan my day</h2>
        <label className="inline-form">
          <span className="visually-hidden">Day to plan</span>
          <input type="date" value={date} min={today} onChange={(e) => e.target.value && (setDate(e.target.value), setItems(null))} aria-label="Day to plan" />
        </label>
      </div>
      <p className="muted">{longDate.format(new Date(`${date}T00:00:00Z`))}</p>

      {latest && !latest.undone && (
        <p className="plan-done" role="status">
          Planned {longDate.format(new Date(`${latest.date}T00:00:00Z`))}: {latest.created} new {latest.created === 1 ? 'task' : 'tasks'}
          {latest.updated ? `, ${latest.updated} rescheduled` : ''}
          {latest.blocks ? `, ${latest.blocks} calendar ${latest.blocks === 1 ? 'block' : 'blocks'}` : ''}.{' '}
          <button type="button" className="link-button" onClick={() => void api.plan.undo(latest.id).catch((e: unknown) => setError(toAppError(e).message))}>
            Undo
          </button>
        </p>
      )}

      {!items && (
        <section aria-labelledby={`${id}-dump`} className="plan-step">
          <h3 id={`${id}-dump`}>1. What do you need to do?</h3>
          <label htmlFor={`${id}-text`} className="hint">One per line. Add a length like “1h” or “30m” (30 minutes if you leave it out).</label>
          <textarea id={`${id}-text`} rows={7} value={dump} onChange={(e) => setDump(e.target.value)} placeholder={'Write quarterly report 2h p1\nGroceries 45m\nCall the bank 15m\nGym 1h'} />
          {dueThatDay.length > 0 && (
            <fieldset className="field">
              <legend>Already due by then</legend>
              {dueThatDay.map((t) => (
                <label key={t.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={picked.has(t.id)}
                    onChange={(e) => setPicked((s) => {
                      const n = new Set(s)
                      if (e.target.checked) n.add(t.id)
                      else n.delete(t.id)
                      return n
                    })}
                  />
                  {t.title}
                  {t.estimateMinutes ? <span className="muted"> ({t.estimateMinutes} min)</span> : null}
                </label>
              ))}
            </fieldset>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="button" className="primary" onClick={layOut}>Lay it out on the day</button>
        </section>
      )}

      {items && (
        <section aria-labelledby={`${id}-board`} className="plan-step">
          <div className="pane-head">
            <h3 id={`${id}-board`}>2. Arrange your day</h3>
            <span className="pane-actions">
              <button type="button" onClick={() => setItems(autoArrange(items, day, buffer))} disabled={tray.length === 0}>Auto-arrange the rest</button>
              <button type="button" className="ghost" onClick={() => setItems(items.map((i) => ({ ...i, start: null })))}>Clear</button>
              <button type="button" className="ghost" onClick={() => setItems(null)}>Back</button>
            </span>
          </div>
          <div className="plan-settings">
            <label>
              My day runs from <input type="time" value={windowStart} onChange={(e) => e.target.value && setWindowStart(e.target.value)} />
            </label>
            <label>
              to <input type="time" value={windowEnd} onChange={(e) => e.target.value && setWindowEnd(e.target.value)} />
            </label>
            <label>
              Breaks between blocks{' '}
              <select value={buffer} onChange={(e) => setBuffer(Number(e.target.value))}>
                {[0, 5, 10, 15].map((m) => <option key={m} value={m}>{m === 0 ? 'none' : `${m} min`}</option>)}
              </select>
            </label>
          </div>
          {allDay.length > 0 && <p className="muted">All day: {allDay.map((e) => e.title).join(', ')}</p>}
          <div className="plan-board">
            <DayGrid
              window={windowOf(day)}
              zone={zone}
              events={timed.filter((e) => !e.transparent)}
              items={items}
              problems={problems}
              gridRef={gridRef}
              onMove={(k, s) => setItems((xs) => xs && place(xs, k, s))}
              onNudge={(k, n) => setItems((xs) => xs && nudge(xs, k, n))}
              onResize={(k, m) => setItems((xs) => xs && resize(xs, k, m))}
              onUnplace={(k) => setItems((xs) => xs && unplace(xs, k))}
            />
            <aside className="plan-tray" aria-label="Not placed yet">
              <h4>Not placed yet ({tray.length})</h4>
              {tray.length === 0 ? (
                <p className="muted">Everything has a time.</p>
              ) : (
                <ul>
                  {tray.map((i) => (
                    <li key={i.key} className="tray-item" onPointerDown={(e) => onTrayPointerDown(e, i.key)} onPointerUp={onTrayPointerUp} onPointerCancel={() => (trayDrag.current = null)}>
                      <span>
                        <strong>{i.title}</strong> <span className="muted">{i.minutes} min</span>
                      </span>
                      <span className="tray-actions">
                        <button type="button" aria-label={`Place ${i.title}`} onClick={() => setItems(placeOne(items, i.key, day, buffer))}>
                          Place
                        </button>
                        {!i.taskId && (
                          <button type="button" className="ghost" aria-label={`Remove ${i.title}`} onClick={() => setItems(items.filter((x) => x.key !== i.key))}>
                            Remove
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">Drag an item onto the timeline, or use Place. Drag a block to move it; drag its bottom edge to change its length.</p>
            </aside>
          </div>
          {hasProblems && (
            <div className="error-text" role="alert">
              Fix these before confirming:
              <ul>{[...problems.values()].flat().map((v, n) => <li key={n}>{v.detail}</li>)}</ul>
            </div>
          )}
          <button type="button" className="primary" disabled={placedCount === 0 || hasProblems} onClick={() => setConfirming(true)}>
            Review and confirm ({placedCount})
          </button>
        </section>
      )}

      {items && confirming && (
        <section aria-labelledby={`${id}-confirm`} className="plan-step plan-confirm">
          <h3 id={`${id}-confirm`}>3. Confirm</h3>
          <ul>
            {items.filter((i) => i.start).sort((a, b) => a.start!.localeCompare(b.start!)).map((i) => (
              <li key={i.key}>
                {new Date(i.start!).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone })} · <strong>{i.title}</strong> ({i.minutes} min){i.taskId ? ' · existing task, rescheduled' : ' · new task'}
              </li>
            ))}
          </ul>
          <label className="check-row">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            Remind me {REMINDER_MINUTES} minutes before each
          </label>
          {canBlock ? (
            <div className="field">
              <label className="check-row">
                <input type="checkbox" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} />
                Also add these as blocks on my Google Calendar
              </label>
              {blocks && !google?.blocks.scopeGranted && (
                <p>
                  <button type="button" onClick={() => void api.google.allowBlocks().catch((e: unknown) => setError(toAppError(e).message))}>Allow calendar blocks</button>{' '}
                  <span className="hint">Google will ask once to let Miss Minutes add events to calendars you own.</span>
                </p>
              )}
              {blocks && google?.blocks.scopeGranted && ownCalendars.length > 0 && (
                <label className="inline-form">
                  Calendar
                  <select value={chosenCalendar} onChange={(e) => setCalendarId(e.target.value)}>
                    {ownCalendars.map((c) => <option key={c.id} value={c.id}>{c.summary}</option>)}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <p className="hint">Connect Google Calendar in Settings to also put these blocks on your calendar.</p>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="primary" disabled={busy || (blocks && canBlock && !google?.blocks.scopeGranted)} onClick={() => void confirm()}>
              {busy ? 'Saving…' : 'Create the plan'}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>Keep editing</button>
          </div>
        </section>
      )}
    </div>
  )
}
