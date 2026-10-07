// Which 📱 reminders should currently exist as events on the user's phone
// (D8). Pure, so the rules are testable without Google.
//
// Each upcoming occurrence of a reminder marked "phone" becomes one short
// event on a dedicated "Miss Minutes reminders" calendar, with a popup alert
// at its start. Google Calendar on the phone then shows the notification, even
// when the PC is off.
//
// Only occurrences in a bounded future window are mirrored. That keeps the
// calendar tidy and the work per sync small; later ones appear as time
// passes.

import type { Task } from '../tasks/types'
import type { LocalTime } from '../time'
import { occurrenceOf } from './rules'

export const PHONE_WINDOW_DAYS = 60
/** An occurrence this recently past is still kept, so a just-fired reminder isn't deleted mid-notification. */
const GRACE_MS = 5 * 60_000

export interface DesiredPhoneEvent {
  ruleId: string
  occurrence: string
  taskId: string
  title: string
  start: Date
}

export function desiredPhoneEvents(tasks: Task[], now: Date, zone: string, allDayTime?: LocalTime): DesiredPhoneEvent[] {
  const horizon = now.getTime() + PHONE_WINDOW_DAYS * 86_400_000
  const out: DesiredPhoneEvent[] = []
  for (const t of tasks) {
    if (t.status !== 'open') continue
    for (const rule of t.reminders) {
      if (!rule.phone) continue
      const occ = occurrenceOf(rule, t.due, zone, allDayTime)
      if (!occ) continue
      const at = occ.instant.getTime()
      if (at < Date.parse(rule.scheduledAt) || at < now.getTime() - GRACE_MS || at > horizon) continue
      out.push({ ruleId: rule.id, occurrence: occ.local, taskId: t.id, title: t.title, start: occ.instant })
    }
  }
  return out
}
