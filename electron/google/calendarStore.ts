// The local copy of the user's Google calendars and of the synced event window.

import type { GoogleCalendarListEntry } from '../../src/core/calendar/google'
import { readableCalendar } from '../../src/core/calendar/google'
import { overlapsLocalRange, type CalendarEvent } from '../../src/core/today'
import type { SqlDatabase } from '../db/database'

export interface StoredCalendar {
  id: string
  summary: string
  color: string | null
  accessRole: GoogleCalendarListEntry['accessRole']
  primary: boolean
  selected: boolean
  /** Free/busy-only calendars expose no event details, so they can't be shown. */
  readable: boolean
}

export class CalendarStore {
  private readonly stmt

  constructor(private readonly db: SqlDatabase) {
    this.stmt = {
      all: db.prepare('SELECT * FROM google_calendars ORDER BY sort_order'),
      get: db.prepare('SELECT * FROM google_calendars WHERE id = @id'),
      upsert: db.prepare(`
        INSERT INTO google_calendars (id, summary, color, access_role, is_primary, selected, sort_order)
        VALUES (@id, @summary, @color, @access_role, @is_primary, @selected, @sort_order)
        ON CONFLICT (id) DO UPDATE SET summary = excluded.summary, color = excluded.color,
          access_role = excluded.access_role, is_primary = excluded.is_primary, sort_order = excluded.sort_order`),
      select: db.prepare('UPDATE google_calendars SET selected = @selected WHERE id = @id'),
      deleteCalendar: db.prepare('DELETE FROM google_calendars WHERE id = @id'),
      clearEvents: db.prepare('DELETE FROM calendar_events WHERE calendar_id = @calendar_id'),
      insertEvent: db.prepare('INSERT OR REPLACE INTO calendar_events (id, calendar_id, data) VALUES (@id, @calendar_id, @data)'),
      selectedEvents: db.prepare(`
        SELECT e.data, c.color FROM calendar_events e JOIN google_calendars c ON c.id = e.calendar_id WHERE c.selected = 1`),
    }
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  calendars(): StoredCalendar[] {
    return this.stmt.all.all().map((r) => ({
      id: String(r.id),
      summary: String(r.summary),
      color: r.color === null ? null : String(r.color),
      accessRole: String(r.access_role) as StoredCalendar['accessRole'],
      primary: Number(r.is_primary) === 1,
      selected: Number(r.selected) === 1,
      readable: String(r.access_role) !== 'freeBusyReader',
    }))
  }

  /**
   * Records the calendar list from Google. A calendar seen for the first time
   * starts selected if it's shown in Google Calendar's own sidebar (or is the
   * primary calendar); after that, the user's choice in Miss Minutes is kept.
   * Calendars no longer in the list are removed with their events.
   */
  updateCalendars(list: GoogleCalendarListEntry[]): void {
    this.tx(() => {
      const seen = new Set<string>()
      list.forEach((c, i) => {
        seen.add(c.id)
        const isNew = !this.stmt.get.get({ id: c.id })
        this.stmt.upsert.run({
          id: c.id,
          summary: c.summaryOverride ?? c.summary,
          color: c.backgroundColor ?? null,
          access_role: c.accessRole,
          is_primary: c.primary ? 1 : 0,
          selected: isNew ? (readableCalendar(c) && (c.selected || c.primary) ? 1 : 0) : 0, // ignored on update
          sort_order: c.primary ? -1 : i,
        })
      })
      for (const c of this.calendars()) if (!seen.has(c.id)) this.stmt.deleteCalendar.run({ id: c.id })
    })
  }

  setSelected(id: string, selected: boolean): void {
    this.tx(() => {
      this.stmt.select.run({ id, selected: selected ? 1 : 0 })
      if (!selected) this.stmt.clearEvents.run({ calendar_id: id })
    })
  }

  /** Atomically replaces one calendar's cached events. */
  replaceEvents(calendarId: string, events: CalendarEvent[]): void {
    this.tx(() => {
      this.stmt.clearEvents.run({ calendar_id: calendarId })
      for (const e of events) this.stmt.insertEvent.run({ id: e.id, calendar_id: calendarId, data: JSON.stringify(e) })
    })
  }

  /** Cached events from selected calendars overlapping [from, to], in the calendar's current colour. */
  eventsBetween(from: string, to: string, zone: string): CalendarEvent[] {
    return this.stmt.selectedEvents
      .all()
      .map((r) => {
        const e = JSON.parse(String(r.data)) as CalendarEvent
        return r.color ? { ...e, color: String(r.color) } : e
      })
      .filter((e) => overlapsLocalRange(e, from, to, zone))
      .sort((a, b) => a.start.localeCompare(b.start))
  }

  /** Forgets every calendar and event (on disconnect). */
  clear(): void {
    this.tx(() => {
      for (const c of this.calendars()) this.stmt.deleteCalendar.run({ id: c.id })
    })
  }
}
