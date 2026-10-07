// Wall-clock time, time zones and daylight saving time.
//
// Two kinds of time appear in this app:
// - instants: a moment on the global timeline ("the meeting starts at
//   14:00Z"). Stored as UTC ISO strings or Date objects.
// - wall-clock times: what a person means by "8 am on Tuesday". Stored as plain
//   strings: LocalDate "2026-03-08", LocalTime "08:00". They mean nothing
//   until a time zone is chosen.
//
// A task due "Tuesday 08:00" stays at 08:00 whatever the zone's UTC offset is
// that day, so tasks and reminders store wall-clock times (D6) and convert to
// an instant only when needed, here, in one place.
//
// The hard part is that the conversion isn't always one-to-one:
// - Spring forward (Toronto, 2nd Sunday of March): clocks jump 02:00 → 03:00,
//   so 02:30 never happens. That's a "gap".
// - Fall back (Toronto, 1st Sunday of November): clocks go 02:00 → 01:00, so
//   01:30 happens twice. That's an "overlap".
// The policy follows RFC 5545 (iCalendar), as decided in D14:
// - gap: use the UTC offset from *before* the gap. 02:30 becomes 03:30 EDT,
//   the same instant 02:30 EST would have been.
// - overlap: use the *first* occurrence (the earlier instant).
//
// Only the built-in Intl API is used. It ships the IANA zone database, so no
// time-zone library is needed and the DST policy stays visible here (D26).

import { DAY, HOUR } from './clock'

/** A calendar date with no zone, "YYYY-MM-DD". */
export type LocalDate = string
/** A time of day with no zone, "HH:mm" (24-hour). */
export type LocalTime = string
/** Both, "YYYY-MM-DDTHH:mm". */
export type LocalDateTime = string

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // Round-trip through UTC to reject dates such as 2026-02-30.
  const probe = new Date(Date.UTC(y, mo - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d
}

export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === 'string' && TIME_RE.test(value)
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Reading an instant in a zone

interface Parts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

// Creating an Intl.DateTimeFormat is slow (tens of microseconds); reuse one per zone.
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23', // 00-23, never "24:00"
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(zone, f)
  }
  return f
}

/** The wall-clock reading of `instant` in `zone`. */
function partsIn(instant: Date, zone: string): Parts {
  const out: Record<string, number> = {}
  for (const p of formatterFor(zone).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour!,
    minute: out.minute!,
    second: out.second!,
  }
}

/**
 * The zone's UTC offset at `instant`, in minutes (Toronto in winter: -300).
 * Found by reading the wall clock and comparing it with the instant itself.
 */
export function offsetMinutes(instant: Date, zone: string): number {
  const p = partsIn(instant, zone)
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const exact = Math.floor(instant.getTime() / 1000) * 1000 // the formatter drops milliseconds
  return Math.round((wallAsUtc - exact) / 60_000)
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const pad4 = (n: number) => String(n).padStart(4, '0')

export function toLocalDate(instant: Date, zone: string): LocalDate {
  const p = partsIn(instant, zone)
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`
}

export function toLocalTime(instant: Date, zone: string): LocalTime {
  const p = partsIn(instant, zone)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

export function toLocalDateTime(instant: Date, zone: string): LocalDateTime {
  return `${toLocalDate(instant, zone)}T${toLocalTime(instant, zone)}`
}

// ---------------------------------------------------------------------------
// Turning a wall-clock time into an instant

export type Resolution = 'exact' | 'gap' | 'overlap'

/**
 * Converts a wall-clock date and time in `zone` to an instant, applying the
 * RFC 5545 policy for DST gaps and overlaps (see the file header).
 *
 * How it works: first treat the wall time as if it were UTC (`naive`). The
 * real instant is `naive - offset`, but the offset depends on the instant,
 * which is circular. Zones change offset at most once in any short window, so
 * there are at most two candidate offsets: the one in force a little before
 * and a little after. Try each candidate and keep those that read back as the
 * requested wall time:
 * - one match:   an ordinary time;
 * - two matches: an overlap, so keep the earlier instant;
 * - no match:    a gap, so use the offset from before the gap.
 */
export function resolveLocal(
  date: LocalDate,
  time: LocalTime,
  zone: string,
): { instant: Date; resolution: Resolution } {
  if (!isLocalDate(date)) throw new Error(`Invalid local date: ${date}`)
  if (!isLocalTime(time)) throw new Error(`Invalid local time: ${time}`)
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  const naive = Date.UTC(y, mo - 1, d, h, mi)

  // No zone offset exceeds ±14 h, and transitions are months apart, so these
  // two probes straddle any transition that could affect this wall time.
  const before = offsetMinutes(new Date(naive - DAY), zone)
  const after = offsetMinutes(new Date(naive + DAY), zone)

  const wanted = `${date}T${time}`
  const matches = [...new Set([before, after])]
    .map((off) => new Date(naive - off * 60_000))
    .filter((candidate) => toLocalDateTime(candidate, zone) === wanted)
    .sort((a, b) => a.getTime() - b.getTime())

  if (matches.length === 1) return { instant: matches[0]!, resolution: 'exact' }
  if (matches.length > 1) return { instant: matches[0]!, resolution: 'overlap' }
  return { instant: new Date(naive - before * 60_000), resolution: 'gap' }
}

/** `resolveLocal` without the diagnostics. */
export function toInstant(date: LocalDate, time: LocalTime, zone: string): Date {
  return resolveLocal(date, time, zone).instant
}

/** The first instant of a local day. Midnight itself can fall in a gap in a few zones. */
export function startOfLocalDay(date: LocalDate, zone: string): Date {
  return toInstant(date, '00:00', zone)
}

/** The first instant of the following local day; a day is [start, end). */
export function endOfLocalDay(date: LocalDate, zone: string): Date {
  return startOfLocalDay(addDays(date, 1), zone)
}

// ---------------------------------------------------------------------------
// Calendar arithmetic on plain dates (no zone involved, so no DST surprises)

function parseDate(date: LocalDate): Date {
  if (!isLocalDate(date)) throw new Error(`Invalid local date: ${date}`)
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, mo - 1, d))
}

function formatDate(utcMidnight: Date): LocalDate {
  return `${pad4(utcMidnight.getUTCFullYear())}-${pad2(utcMidnight.getUTCMonth() + 1)}-${pad2(utcMidnight.getUTCDate())}`
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return formatDate(new Date(parseDate(date).getTime() + days * DAY))
}

/**
 * Adds calendar months, clamping to the last day of a shorter month:
 * Jan 31 + 1 month = Feb 28 (or 29), not Mar 3.
 */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const d = parseDate(date)
  const targetMonthIndex = d.getUTCMonth() + months
  const year = d.getUTCFullYear() + Math.floor(targetMonthIndex / 12)
  const month = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return formatDate(new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay))))
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: LocalDate): number {
  return parseDate(date).getUTCDay()
}

/** Whole days from `a` to `b` (positive if b is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY)
}

/** LocalDate strings sort correctly as plain strings; this just names the intent. */
export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Length of a local day in hours: 23 on spring-forward day, 25 on fall-back day. */
export function localDayLengthHours(date: LocalDate, zone: string): number {
  return (endOfLocalDay(date, zone).getTime() - startOfLocalDay(date, zone).getTime()) / HOUR
}
