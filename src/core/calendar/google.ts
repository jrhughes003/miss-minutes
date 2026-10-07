// Google Calendar API shapes, and mapping them onto the app's CalendarEvent.
//
// Only the fields the app reads are typed. Reference:
// https://developers.google.com/workspace/calendar/api/v3/reference/events
//
// The rules that matter (checked against Google's docs, 2026-10-06):
// - Timed events carry `start.dateTime` / `end.dateTime` (RFC 3339 with an
//   offset). All-day events carry `start.date` / `end.date`
//   ("YYYY-MM-DD"), and the end date is exclusive.
// - With `singleEvents=true`, Google expands recurring events into instances.
//   Each instance has `recurringEventId` and `originalStartTime`, and
//   exceptions (moved or cancelled instances) arrive already applied (D11).
// - Cancelled instances can still appear with `status: "cancelled"` and are
//   dropped.

import type { CalendarEvent } from '../today'
import { isLocalDate } from '../time'

export interface GoogleEventTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GoogleEvent {
  id: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  start?: GoogleEventTime
  end?: GoogleEventTime
  recurringEventId?: string
  originalStartTime?: GoogleEventTime
  htmlLink?: string
  transparency?: 'opaque' | 'transparent'
  description?: string
  reminders?: { useDefault: boolean; overrides?: { method: 'popup' | 'email'; minutes: number }[] }
  extendedProperties?: { private?: Record<string, string> }
}

export interface GoogleCalendarListEntry {
  id: string
  summary: string
  summaryOverride?: string
  backgroundColor?: string
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner'
  primary?: boolean
  selected?: boolean
}

/**
 * Maps one Google event to a CalendarEvent, or null if it should not be shown
 * (cancelled, or malformed). The event id is made unique across calendars,
 * because the same event can appear on several calendars you subscribe to.
 */
export function fromGoogleEvent(e: GoogleEvent, calendarId: string, color?: string): CalendarEvent | null {
  if (e.status === 'cancelled' || !e.start || !e.end) return null
  const title = e.summary?.trim() || '(No title)'
  const id = `${calendarId}|${e.id}`
  const base = { id, calendarId, title, ...(color ? { color } : {}) }

  if (e.start.date !== undefined || e.end.date !== undefined) {
    const start = e.start.date
    const end = e.end.date
    if (!isLocalDate(start) || !isLocalDate(end) || end <= start) return null
    return { ...base, allDay: true, start, end }
  }
  const start = e.start.dateTime ? Date.parse(e.start.dateTime) : Number.NaN
  const end = e.end.dateTime ? Date.parse(e.end.dateTime) : Number.NaN
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  // Store as UTC ISO: the offset in Google's string is not needed once it's an instant.
  const planTaskId = e.extendedProperties?.private?.mmBatch ? e.extendedProperties.private.mmTask : undefined
  return {
    ...base,
    allDay: false,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    ...(e.transparency === 'transparent' ? { transparent: true } : {}),
    ...(planTaskId ? { planTaskId } : {}),
  }
}

/** Calendars the app may read events from. Free/busy-only calendars expose no event details. */
export function readableCalendar(c: GoogleCalendarListEntry): boolean {
  return c.accessRole !== 'freeBusyReader'
}
