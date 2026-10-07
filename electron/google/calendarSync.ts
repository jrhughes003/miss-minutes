// Keeps the local calendar cache in step with Google (D11).
//
// Strategy: refetch a fixed window, from 7 days ago to 60 days ahead, for each
// selected calendar, and replace that calendar's cached events in one
// transaction. Google expands recurring events (`singleEvents=true`), so
// exceptions such as a moved or cancelled meeting arrive already applied.
// At personal scale this costs a handful of requests every few minutes, far
// inside the quota, and it can't drift out of step the way an incremental
// sync with a lost token can.

import { fromGoogleEvent, readableCalendar } from '../../src/core/calendar/google'
import { addDays, startOfLocalDay, toLocalDate } from '../../src/core/time'
import type { CalendarEvent } from '../../src/core/today'
import type { GoogleApi } from './api'
import type { CalendarStore } from './calendarStore'

export const WINDOW_DAYS_BEFORE = 7
export const WINDOW_DAYS_AFTER = 60

export interface SyncResult {
  calendars: number
  events: number
}

export async function syncCalendars(api: GoogleApi, store: CalendarStore, now: Date, zone: string): Promise<SyncResult> {
  store.updateCalendars(await api.listCalendars())

  const today = toLocalDate(now, zone)
  const timeMin = startOfLocalDay(addDays(today, -WINDOW_DAYS_BEFORE), zone)
  const timeMax = startOfLocalDay(addDays(today, WINDOW_DAYS_AFTER + 1), zone)

  let count = 0
  for (const cal of store.calendars()) {
    if (!cal.selected || !readableCalendar({ id: cal.id, summary: cal.summary, accessRole: cal.accessRole })) continue
    const raw = await api.listEvents(cal.id, timeMin, timeMax)
    const events = raw.map((e) => fromGoogleEvent(e, cal.id)).filter((e): e is CalendarEvent => e !== null)
    store.replaceEvents(cal.id, events)
    count += events.length
  }
  return { calendars: store.calendars().filter((c) => c.selected).length, events: count }
}
