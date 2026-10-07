import { describe, expect, it } from 'vitest'
import type { Task } from './tasks/types'
import { buildToday, isAllDayEventOn, type CalendarEvent } from './today'

const ZONE = 'America/Toronto'
const NOW = new Date('2026-10-06T15:00:00Z') // Tue Oct 6, 11:00 local

let n = 0
function task(o: Partial<Task> = {}): Task {
  return {
    id: `t${++n}`, title: `Task ${n}`, notes: '', projectId: null, tags: [], priority: 4, due: null,
    estimateMinutes: null, recurrence: null, reminders: [], parentId: null, status: 'open', completedAt: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', order: n, ...o,
  }
}
const allDay = (start: string, end: string, title = 'Holiday'): CalendarEvent => ({ id: title, calendarId: 'c', title, allDay: true, start, end })
const timed = (start: string, end: string, title = 'Meeting'): CalendarEvent => ({ id: title, calendarId: 'c', title, allDay: false, start, end })

describe('buildToday: tasks', () => {
  it('sorts tasks into overdue, all-day today, timed today, inbox and upcoming', () => {
    const tasks = [
      task({ title: 'Late', due: { date: '2026-10-05', time: null } }),
      task({ title: 'Today all day', due: { date: '2026-10-06', time: null } }),
      task({ title: 'Today 14:00', due: { date: '2026-10-06', time: '14:00' } }),
      task({ title: 'Today 09:00', due: { date: '2026-10-06', time: '09:00' } }),
      task({ title: 'Undated inbox' }),
      task({ title: 'Undated in a project', projectId: 'p1' }),
      task({ title: 'Thursday', due: { date: '2026-10-08', time: null } }),
      task({ title: 'Next month', due: { date: '2026-11-06', time: null } }),
      task({ title: 'Done today', due: { date: '2026-10-06', time: '10:00' }, status: 'done' }),
    ]
    const m = buildToday({ tasks, now: NOW, zone: ZONE })
    expect(m.today).toBe('2026-10-06')
    expect(m.overdue.map((t) => t.title)).toEqual(['Late'])
    expect(m.allDay.tasks.map((t) => t.title)).toEqual(['Today all day'])
    expect(m.timeline.map((i) => i.kind === 'task' && i.task.title)).toEqual(['Today 09:00', 'Today 14:00'])
    expect(m.nowIndex).toBe(1) // 11:00 falls between 09:00 and 14:00
    expect(m.inbox.map((t) => t.title)).toEqual(['Undated inbox'])
    expect(m.upcomingCount).toBe(1)
  })

  it('leaves subtasks to their parent', () => {
    const m = buildToday({ tasks: [task({ title: 'Step', parentId: 'x', due: { date: '2026-10-06', time: '12:00' } })], now: NOW, zone: ZONE })
    expect(m.timeline).toEqual([])
  })

  it('uses the local date, not the UTC date', () => {
    // 02:00 UTC on Oct 7 is still Oct 6 in Toronto.
    const m = buildToday({ tasks: [task({ due: { date: '2026-10-06', time: null } })], now: new Date('2026-10-07T02:00:00Z'), zone: ZONE })
    expect(m.today).toBe('2026-10-06')
    expect(m.allDay.tasks).toHaveLength(1)
  })
})

describe('buildToday: reminders', () => {
  it('shows today’s reminders, including those for undated tasks, but not one that repeats the task’s own time', () => {
    const r = (id: string, when: Task['reminders'][number]['when']) => ({ id, when, phone: false, scheduledAt: '2026-10-01T00:00:00Z' })
    const tasks = [
      task({ title: 'Call', reminders: [r('a', { kind: 'at', date: '2026-10-06', time: '16:30' })] }),
      task({ title: 'Meeting prep', due: { date: '2026-10-06', time: '15:00' }, reminders: [r('b', { kind: 'beforeDue', minutes: 30 }), r('c', { kind: 'beforeDue', minutes: 0 })] }),
      task({ title: 'Tomorrow', reminders: [r('d', { kind: 'at', date: '2026-10-07', time: '09:00' })] }),
    ]
    const m = buildToday({ tasks, now: NOW, zone: ZONE })
    expect(m.timeline.map((i) => `${i.time} ${i.kind}`)).toEqual(['14:30 reminder', '15:00 task', '16:30 reminder'])
  })
})

describe('buildToday: calendar events', () => {
  it('treats an all-day event’s end date as exclusive', () => {
    expect(isAllDayEventOn(allDay('2026-10-06', '2026-10-07') as never, '2026-10-06')).toBe(true)
    expect(isAllDayEventOn(allDay('2026-10-05', '2026-10-06') as never, '2026-10-06')).toBe(false) // ended yesterday
    expect(isAllDayEventOn(allDay('2026-10-04', '2026-10-08') as never, '2026-10-06')).toBe(true) // multi-day
    const m = buildToday({ tasks: [], events: [allDay('2026-10-05', '2026-10-06', 'Yesterday'), allDay('2026-10-06', '2026-10-07', 'Today')], now: NOW, zone: ZONE })
    expect(m.allDay.events.map((e) => e.title)).toEqual(['Today'])
  })

  it('places timed events in local time and flags ones crossing midnight', () => {
    const m = buildToday({
      tasks: [task({ title: 'Lunch task', due: { date: '2026-10-06', time: '12:00' } })],
      events: [
        timed('2026-10-06T16:00:00Z', '2026-10-06T17:00:00Z', 'Noon meeting'), // 12:00–13:00
        timed('2026-10-06T02:00:00Z', '2026-10-06T05:00:00Z', 'Late night'), // Oct 5 22:00 → Oct 6 01:00
        timed('2026-10-07T03:00:00Z', '2026-10-07T05:00:00Z', 'Overnight'), // Oct 6 23:00 → Oct 7 01:00
        timed('2026-10-07T13:00:00Z', '2026-10-07T14:00:00Z', 'Tomorrow'),
      ],
      now: NOW,
      zone: ZONE,
    })
    expect(m.timeline.map((i) => (i.kind === 'event' ? `${i.time}-${i.endTime} ${i.event.title}${i.startedEarlier ? ' <' : ''}${i.endsLater ? ' >' : ''}` : `${i.time} ${i.task.title}`))).toEqual([
      '00:00-01:00 Late night <',
      '12:00-13:00 Noon meeting',
      '12:00 Lunch task',
      '23:00-24:00 Overnight >',
    ])
  })

  it('handles events on a 25-hour fall-back day', () => {
    // 2026-11-01 in Toronto runs from 04:00Z to 05:00Z the next day.
    const m = buildToday({ tasks: [], events: [timed('2026-11-02T04:30:00Z', '2026-11-02T05:30:00Z', 'Edge')], now: new Date('2026-11-01T16:00:00Z'), zone: ZONE })
    expect(m.timeline.map((i) => i.kind === 'event' && `${i.time}-${i.endTime}`)).toEqual(['23:30-24:00'])
  })
})
