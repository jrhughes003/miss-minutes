// Mirrors 📱 reminders to the phone through a "Miss Minutes reminders" Google
// calendar (D8, D37).
//
// Each run compares what *should* exist (desiredPhoneEvents) with what this
// app put there before (the phone_events table), and converges:
//   missing  → create, with an id derived from rule + occurrence. Google
//              refuses a second create with the same id (409), so a retry
//              after a crash can never make a duplicate (D12); a 409 is
//              answered with an update instead.
//   changed  → update (a content hash says whether anything changed);
//   obsolete → delete (task done or deleted, reminder removed or moved, or
//              the time has passed).
// Only events this app created are ever touched, and only on its own calendar.

import { createHash } from 'node:crypto'
import type { GoogleEvent } from '../../src/core/calendar/google'
import type { Clock } from '../../src/core/clock'
import { desiredPhoneEvents, type DesiredPhoneEvent } from '../../src/core/reminders/phone'
import type { SettingsStore } from '../../src/core/settings'
import type { TaskService } from '../../src/core/tasks/service'
import type { LocalTime } from '../../src/core/time'
import type { SqlDatabase } from '../db/database'
import { GoogleApiError, type GoogleApi } from './api'

export const PHONE_CALENDAR_NAME = 'Miss Minutes reminders'
const CALENDAR_SETTING = 'google.phoneCalendarId'
const EVENT_MINUTES = 15

/** Google event ids allow the characters a–v and 0–9 (base32hex). Lower-case hex is a subset. */
export function phoneEventId(ruleId: string, occurrence: string): string {
  return `mm${createHash('sha256').update(`${ruleId}|${occurrence}`).digest('hex').slice(0, 40)}`
}

export function phoneEventBody(d: DesiredPhoneEvent, zone: string): GoogleEvent {
  return {
    id: phoneEventId(d.ruleId, d.occurrence),
    summary: `⏰ ${d.title}`,
    description: 'Reminder from Miss Minutes. Complete or change the task in Miss Minutes; this event updates itself.',
    start: { dateTime: d.start.toISOString(), timeZone: zone },
    end: { dateTime: new Date(d.start.getTime() + EVENT_MINUTES * 60_000).toISOString(), timeZone: zone },
    // The point of the event: a notification on the phone at the reminder time.
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    // Doesn't show as busy, so it never blocks free time (plan my day, M10).
    transparency: 'transparent',
    extendedProperties: { private: { mmRule: d.ruleId, mmOccurrence: d.occurrence, mmTask: d.taskId } },
  }
}

const hashOf = (body: GoogleEvent) => {
  const { id: _id, ...content } = body
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16)
}

export interface PhoneMirrorResult {
  created: number
  updated: number
  deleted: number
}

export class PhoneMirror {
  private readonly q

  constructor(
    private readonly o: { api: GoogleApi; db: SqlDatabase; tasks: TaskService; clock: Clock; settings: SettingsStore; allDayTime: () => LocalTime },
  ) {
    this.q = {
      rows: o.db.prepare('SELECT * FROM phone_events'),
      upsert: o.db.prepare(`INSERT INTO phone_events (event_id, rule_id, occurrence, task_id, content_hash) VALUES (@id, @rule, @occ, @task, @hash)
        ON CONFLICT (event_id) DO UPDATE SET content_hash = excluded.content_hash`),
      remove: o.db.prepare('DELETE FROM phone_events WHERE event_id = @id'),
      clear: o.db.prepare('DELETE FROM phone_events'),
    }
  }

  calendarId(): string | null {
    return this.o.settings.get(CALENDAR_SETTING) || null
  }

  /** The app's own calendar: reused if it still exists, otherwise created. */
  private async ensureCalendar(): Promise<string> {
    const known = this.calendarId()
    if (known) {
      const all = await this.o.api.listCalendars()
      if (all.some((c) => c.id === known)) return known
      this.q.clear.run() // the user deleted the calendar: its events are gone too
    }
    const created = await this.o.api.insertCalendar(PHONE_CALENDAR_NAME, this.o.clock.zone())
    this.o.settings.set(CALENDAR_SETTING, created.id)
    return created.id
  }

  async sync(): Promise<PhoneMirrorResult> {
    const result: PhoneMirrorResult = { created: 0, updated: 0, deleted: 0 }
    const zone = this.o.clock.zone()
    const desired = desiredPhoneEvents(this.o.tasks.listTasks({ status: 'open', includeSubtasks: true }), this.o.clock.now(), zone, this.o.allDayTime())
    if (desired.length === 0 && this.q.rows.all().length === 0) return result // nothing to do, and no calendar needed
    const calendarId = await this.ensureCalendar()
    const current = new Map(this.q.rows.all().map((r) => [String(r.event_id), String(r.content_hash)]))

    const wanted = new Set<string>()
    for (const d of desired) {
      const body = phoneEventBody(d, zone)
      const id = body.id!
      const hash = hashOf(body)
      wanted.add(id)
      const save = () => this.q.upsert.run({ id, rule: d.ruleId, occ: d.occurrence, task: d.taskId, hash })
      if (!current.has(id)) {
        try {
          await this.o.api.insertEvent(calendarId, body)
          result.created++
        } catch (e) {
          // Already there (a retry after a crash): bring it up to date instead.
          if (!(e instanceof GoogleApiError && e.status === 409)) throw e
          const { id: _id, ...patch } = body
          await this.o.api.patchEvent(calendarId, id, patch)
          result.updated++
        }
        save()
      } else if (current.get(id) !== hash) {
        const { id: _id, ...patch } = body
        await this.o.api.patchEvent(calendarId, id, patch)
        save()
        result.updated++
      }
    }
    for (const id of current.keys()) {
      if (wanted.has(id)) continue
      await this.o.api.deleteEvent(calendarId, id).catch((e: unknown) => {
        if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e
      })
      this.q.remove.run({ id })
      result.deleted++
    }
    return result
  }

  /** Removes every mirrored event (phone reminders turned off, or disconnecting). */
  async removeAll(): Promise<void> {
    const calendarId = this.calendarId()
    if (calendarId) {
      for (const r of this.q.rows.all()) {
        await this.o.api.deleteEvent(calendarId, String(r.event_id)).catch(() => {})
      }
    }
    this.q.clear.run()
  }
}
