// Free time on a day: the planning window minus busy time.
//
// Only the *shape* of the day is needed to plan (when you're free), never
// what fills the busy parts. That's why plan-my-day can send Claude free
// intervals alone and no event details (D18).

import { toInstant } from '../time'
import { MIN_BLOCK_MINUTES, type Interval, type PlanDay } from './types'

const ms = (iso: string) => Date.parse(iso)
const iso = (t: number) => new Date(t).toISOString()

/** Merges overlapping or touching intervals into a sorted, disjoint list. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => ms(i.end) > ms(i.start)).sort((a, b) => ms(a.start) - ms(b.start))
  const out: Interval[] = []
  for (const i of sorted) {
    const last = out.at(-1)
    if (last && ms(i.start) <= ms(last.end)) {
      if (ms(i.end) > ms(last.end)) last.end = i.end
    } else out.push({ ...i })
  }
  return out
}

/** The planning window as instants. Wall-clock times go through time.ts, so a DST day has the right length. */
export function windowOf(day: PlanDay): Interval {
  return { start: toInstant(day.date, day.window.start, day.zone).toISOString(), end: toInstant(day.date, day.window.end, day.zone).toISOString() }
}

/** Free gaps of at least MIN_BLOCK_MINUTES inside the window, after `notBefore`, not overlapping busy time. */
export function freeSlots(day: PlanDay): Interval[] {
  const w = windowOf(day)
  let start = ms(w.start)
  if (day.notBefore) start = Math.max(start, ms(day.notBefore))
  const end = ms(w.end)
  const out: Interval[] = []
  let cursor = start
  for (const b of mergeIntervals(day.busy)) {
    if (ms(b.end) <= cursor) continue
    if (ms(b.start) >= end) break
    if (ms(b.start) > cursor) out.push({ start: iso(cursor), end: iso(Math.min(ms(b.start), end)) })
    cursor = Math.max(cursor, ms(b.end))
  }
  if (cursor < end) out.push({ start: iso(cursor), end: iso(end) })
  return out.filter((g) => ms(g.end) - ms(g.start) >= MIN_BLOCK_MINUTES * 60_000)
}

export const minutesOf = (i: Interval) => (ms(i.end) - ms(i.start)) / 60_000
