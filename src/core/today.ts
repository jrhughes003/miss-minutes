// Builds the Today view: overdue tasks, today's tasks, reminders and (from
// M5) calendar events, merged onto one timeline.
//
// Calendar events follow Google Calendar's conventions, so M5 only has to
// supply them:
// - Timed events have start and end *instants*. An event belongs to today if
//   it overlaps today's half-open interval [00:00, next 00:00) in the user's
//   zone. One that started yesterday or ends tomorrow is shown with a
//   "continues" flag rather than hidden.
// - All-day events have start and end *dates*, and the end date is
//   exclusive: a one-day event on Oct 8 is {start: Oct 8, end: Oct 9}, and a
//   three-day trip Oct 8–10 is {start: Oct 8, end: Oct 11}. So "is it on
//   today?" is start ≤ today < end. Treating the end as inclusive would show
//   every all-day event for one day too many.

import { occurrenceOf } from './reminders/rules'
import type { Task } from './tasks/types'
import { compareTasks } from './tasks/service'
import { endOfLocalDay, startOfLocalDay, toLocalDateTime, toLocalTime, type LocalDate, type LocalTime } from './time'

export type CalendarEvent =
  | { id: string; calendarId: string; title: string; allDay: true; start: LocalDate; end: LocalDate; color?: string }
  | { id: string; calendarId: string; title: string; allDay: false; start: string; end: string; color?: string }

export type TimelineItem =
  | { kind: 'task'; time: LocalTime; task: Task }
  | { kind: 'reminder'; time: LocalTime; task: Task; ruleId: string }
  | {
      kind: 'event'
      time: LocalTime
      endTime: LocalTime
      event: Extract<CalendarEvent, { allDay: false }>
      startedEarlier: boolean
      endsLater: boolean
    }

export interface TodayModel {
  today: LocalDate
  overdue: Task[]
  /** Tasks due today with no time, and all-day events. */
  allDay: { tasks: Task[]; events: Extract<CalendarEvent, { allDay: true }>[] }
  /** Timed items in time order. */
  timeline: TimelineItem[]
  /** Index in `timeline` where "now" falls: items before it are past. */
  nowIndex: number
  /** Open, undated tasks with no project. */
  inbox: Task[]
  /** Open tasks due in the next 6 days, for a "coming up" count. */
  upcomingCount: number
}

export interface TodayInput {
  tasks: Task[]
  events?: CalendarEvent[]
  now: Date
  zone: string
  allDayTime?: LocalTime
}

export function isAllDayEventOn(e: Extract<CalendarEvent, { allDay: true }>, day: LocalDate): boolean {
  return e.start <= day && day < e.end // end is exclusive
}

/** Does the event overlap the local dates [from, to] (inclusive) in `zone`? */
export function overlapsLocalRange(e: CalendarEvent, from: LocalDate, to: LocalDate, zone: string): boolean {
  if (e.allDay) return e.start <= to && e.end > from
  const start = startOfLocalDay(from, zone).toISOString()
  const end = endOfLocalDay(to, zone).toISOString()
  return e.start < end && e.end > start
}

export function buildToday({ tasks, events = [], now, zone, allDayTime }: TodayInput): TodayModel {
  const today = toLocalDateTime(now, zone).slice(0, 10)
  const dayStart = startOfLocalDay(today, zone)
  const dayEnd = endOfLocalDay(today, zone)
  const open = tasks.filter((t) => t.status === 'open')
  const topLevel = open.filter((t) => t.parentId === null)

  const overdue = topLevel.filter((t) => t.due && t.due.date < today).sort(compareTasks)
  const dueToday = topLevel.filter((t) => t.due?.date === today)
  const inbox = topLevel.filter((t) => !t.due && t.projectId === null).sort(compareTasks)
  const weekAhead = new Date(dayStart.getTime() + 7 * 86_400_000)
  const upcomingCount = topLevel.filter((t) => t.due && t.due.date > today && startOfLocalDay(t.due.date, zone) < weekAhead).length

  const timeline: TimelineItem[] = []
  for (const t of dueToday) if (t.due?.time) timeline.push({ kind: 'task', time: t.due.time, task: t })

  // Reminders today, unless the reminder is for a task already on the timeline
  // at the same minute (a reminder "at due time" would just repeat the task).
  for (const t of open) {
    for (const rule of t.reminders) {
      const occ = occurrenceOf(rule, t.due, zone, allDayTime)
      if (!occ || occ.instant < dayStart || occ.instant >= dayEnd) continue
      const time = occ.local.slice(11)
      if (t.due?.date === today && t.due.time === time) continue
      timeline.push({ kind: 'reminder', time, task: t, ruleId: rule.id })
    }
  }

  const allDayEvents: Extract<CalendarEvent, { allDay: true }>[] = []
  for (const e of events) {
    if (e.allDay) {
      if (isAllDayEventOn(e, today)) allDayEvents.push(e)
      continue
    }
    const start = new Date(e.start)
    const end = new Date(e.end)
    if (!(start < dayEnd && end > dayStart)) continue // no overlap with today
    const startedEarlier = start < dayStart
    const endsLater = end > dayEnd
    timeline.push({
      kind: 'event',
      time: startedEarlier ? '00:00' : toLocalTime(start, zone),
      endTime: endsLater ? '24:00' : toLocalTime(end, zone),
      event: e,
      startedEarlier,
      endsLater,
    })
  }

  // Events first at the same minute (fixed commitments), then tasks, then reminders.
  const rank = { event: 0, task: 1, reminder: 2 } as const
  timeline.sort((a, b) => a.time.localeCompare(b.time) || rank[a.kind] - rank[b.kind])

  const nowTime = toLocalTime(now, zone)
  const nowIndex = timeline.findIndex((i) => i.time > nowTime)

  return {
    today,
    overdue,
    allDay: { tasks: dueToday.filter((t) => !t.due?.time).sort(compareTasks), events: allDayEvents },
    timeline,
    nowIndex: nowIndex === -1 ? timeline.length : nowIndex,
    inbox,
    upcomingCount,
  }
}
