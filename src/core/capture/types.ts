// Natural-language capture: turning "remind me to call the dentist Thursday
// after lunch" into a structured task.
//
// Two parsers produce this same shape:
// - the deterministic baseline (chrono-node plus a little glue), which works
//   offline and is the fallback when AI is off or fails;
// - Claude (M6), through structured outputs.
// The parse eval (eval/parse/) grades both on identical cases.

import type { Priority } from '../tasks/types'
import type { LocalDate, LocalTime } from '../time'

export interface CaptureResult {
  /** "clarify" when the input is ambiguous enough that guessing could put the task on the wrong day. */
  kind: 'task' | 'clarify'
  title: string
  due: { date: LocalDate; time: LocalTime | null } | null
  priority: Priority
  /** Must be one of the user's existing project names, or null. */
  projectName: string | null
  tags: string[]
  /** An RRULE body such as "FREQ=WEEKLY;BYDAY=TU", or null. */
  recurrence: string | null
  /** A reminder this many minutes before the due time (0 = at the due time), or null. */
  reminderMinutesBefore: number | null
  /** The question to ask the user when kind is "clarify". */
  question: string | null
}

export interface CaptureContext {
  /** The user's current local date and time, e.g. "2026-10-06T10:00". */
  nowLocal: string
  zone: string
  projectNames: string[]
  tagNames: string[]
}

/**
 * Conventions both parsers follow and the eval grades against. They are
 * written down so "correct" is defined before any results exist.
 */
export const CAPTURE_CONVENTIONS = `
- Week starts on Monday.
- A bare weekday ("Thursday") means the next occurrence after today. If today is that weekday, the input is ambiguous (today or a week from now): ask.
- "this <weekday>": that day in the current Monday–Sunday week; if it has already passed this week, ask.
- "next <weekday>": that day in the following Monday–Sunday week.
- Fuzzy times: "morning" 09:00, "noon"/"lunch" 12:00, "after lunch" 13:00, "afternoon" 14:00, "end of day"/"EOD" 17:00, "evening"/"tonight" 19:00.
- "tonight at 12:30" (or any time from 12:00 to 04:59 said with "tonight") means after midnight, on the next calendar date.
- "midnight" with a day ("midnight on Friday") is ambiguous (the start or the end of Friday): ask.
- No time mentioned: the task is all-day (time null).
- A date that doesn't exist ("the 31st" in a 30-day month, "Feb 30"): ask.
- "remind me to X" creates task X with a reminder at its due time (0 minutes before). "remind me N minutes/hours before" sets that offset.
- Priority: "p1".."p4", or "urgent" = 1, "important" = 2. Default 4.
- Tags: words written as #tag. Projects: "@Name", or a phrase naming an existing project ("for work", "in Home"); only existing project names count.
- Recurrence: "every day" FREQ=DAILY; "every weekday" FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR; "every <weekday>" FREQ=WEEKLY;BYDAY=<XX>; "every other <weekday>" FREQ=WEEKLY;INTERVAL=2;BYDAY=<XX>; "every month" FREQ=MONTHLY; "first Monday of the month" FREQ=MONTHLY;BYDAY=1MO; "every year" FREQ=YEARLY. The due date is the first occurrence.
- The title is the task itself, without the date, time, priority, tags, project or "remind me to".
`.trim()
