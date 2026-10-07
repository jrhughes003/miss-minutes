// The deterministic capture parser: chrono-node for dates and times, plus a
// few regular expressions for priority, tags, project, repeats and "remind
// me". It needs no network and no API key. It's the fallback whenever AI is
// off or fails, and the baseline the parse eval compares Claude against.
//
// It deliberately stays simple, so the eval measures what a reasonable
// non-AI parser achieves, not a parser tuned to the test cases. It never asks
// a clarifying question: it always guesses.

import * as chronoModule from 'chrono-node'
import { addDays, dayOfWeek, offsetMinutes, resolveLocal, type LocalDate } from '../time'
import type { Priority } from '../tasks/types'
import type { CaptureContext, CaptureResult } from './types'

// Same CommonJS/ES interop as rrule (see recurrence.ts): the named export
// exists in bundlers, but only on `default` under Node's own ESM loader.
type ChronoModule = typeof chronoModule
const chrono: ChronoModule = (chronoModule as unknown as { default?: ChronoModule }).default ?? chronoModule

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
const DAY_NAMES: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
const pad = (n: number) => String(n).padStart(2, '0')

export function parseBaseline(text: string, ctx: CaptureContext): CaptureResult {
  let work = ` ${text.trim()} `
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(work)
    if (m) work = work.slice(0, m.index) + ' ' + work.slice(m.index + m[0].length)
    return m
  }

  // Priority.
  let priority: Priority = 4
  const p = take(/\s[pP]([1-4])\b/)
  if (p) priority = Number(p[1]) as Priority
  else if (take(/\s(urgent)\b/i)) priority = 1
  else if (take(/\s(important)\b/i)) priority = 2

  // Tags and project.
  const tags: string[] = []
  for (let m = take(/\s#([\p{L}\p{N}_-]+)/u); m; m = take(/\s#([\p{L}\p{N}_-]+)/u)) tags.push(m[1]!.toLowerCase())
  let projectName: string | null = null
  const at = /\s@([\p{L}\p{N}_-]+)/u.exec(work)
  if (at) {
    const match = ctx.projectNames.find((n) => n.toLowerCase() === at[1]!.toLowerCase())
    if (match) {
      projectName = match
      take(/\s@([\p{L}\p{N}_-]+)/u)
    }
  }

  // Reminders.
  let reminderMinutesBefore: number | null = null
  if (take(/^\s*remind me( to)?\s/i)) reminderMinutesBefore = 0
  const before = take(/\s(\d+)\s*(minutes?|mins?|hours?|hrs?)\s+before\b/i)
  if (before) reminderMinutesBefore = Number(before[1]) * (/^h/i.test(before[2]!) ? 60 : 1)

  // Repeats.
  let recurrence: string | null = null
  let repeatDay: number | null = null
  if (take(/\s(every weekday|on weekdays|weekdays)\b/i)) recurrence = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
  else {
    const other = take(/\severy other (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)
    const each = other ? null : take(/\s(?:every|each) (sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i)
    const m = other ?? each
    if (m) {
      repeatDay = DAY_NAMES[m[1]!.toLowerCase()]!
      recurrence = `FREQ=WEEKLY;${other ? 'INTERVAL=2;' : ''}BYDAY=${DAYS[repeatDay]}`
    } else if (take(/\s(every day|daily|each day)\b/i)) recurrence = 'FREQ=DAILY'
    else if (take(/\s(every week|weekly)\b/i)) recurrence = 'FREQ=WEEKLY'
    else if (take(/\s(every month|monthly)\b/i)) recurrence = 'FREQ=MONTHLY'
    else if (take(/\s(every year|yearly|annually)\b/i)) recurrence = 'FREQ=YEARLY'
  }

  // Date and time, read in the user's zone.
  const [nowDate, nowTime] = ctx.nowLocal.split('T') as [LocalDate, string]
  const now = resolveLocal(nowDate, nowTime.slice(0, 5), ctx.zone).instant
  let due: CaptureResult['due'] = null
  const parsed = chrono.parse(work, { instant: now, timezone: offsetMinutes(now, ctx.zone) }, { forwardDate: true })[0]
  if (parsed) {
    const s = parsed.start
    const date = `${s.get('year')}-${pad(s.get('month')!)}-${pad(s.get('day')!)}`
    const time = s.isCertain('hour') ? `${pad(s.get('hour')!)}:${pad(s.get('minute') ?? 0)}` : null
    due = { date, time }
    work = work.replace(parsed.text, ' ')
  }
  if (!due && repeatDay !== null) {
    // "every Tuesday" with no start date: the first Tuesday on or after today.
    const gap = (repeatDay - dayOfWeek(nowDate) + 7) % 7
    due = { date: addDays(nowDate, gap), time: null }
  } else if (!due && recurrence) {
    due = { date: nowDate, time: null }
  }

  const title = work
    .replace(/\s+/g, ' ')
    .replace(/^\s*(to|about)\s+/i, '')
    .replace(/\s+(on|at|by|for|in|from|starting)\s*$/i, '')
    .replace(/[\s,.;:!-]+$/, '')
    .trim()

  return {
    kind: 'task',
    title: title || text.trim(),
    due,
    priority,
    projectName,
    tags,
    recurrence,
    reminderMinutesBefore,
    question: null,
  }
}
