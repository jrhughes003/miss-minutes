// The plan-my-day eval: 200 generated days, frozen 2026-10-07 before any plan
// prompt was written (PLAN.md §5.2). The first draft overloaded 106 of 200 days
// against the planned ~15 %; it was corrected to match the plan before any
// planner other than the greedy baseline had run (D38).
//
// Each day has calendar busy time, 3–15 candidate tasks (estimates,
// priorities, deadlines), and sometimes a "now" (planning the rest of today).
// About 15 % of days are deliberately overloaded: more work than free time.
// A good plan then says what it couldn't fit rather than overpacking.
// The dates include both 2026 DST changes in Toronto.

import { addDays, toInstant, type LocalDate } from '../../src/core/time'
import { freeSlots, minutesOf } from '../../src/core/plan/slots'
import type { PlanDay, PlanTask } from '../../src/core/plan/types'

export interface PlanCase {
  id: string
  day: PlanDay
  tasks: PlanTask[]
  /** More estimated work than free time. */
  infeasible: boolean
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ZONE = 'America/Toronto'
const ESTIMATES = [15, 15, 30, 30, 30, 45, 60, 90]
const TITLES = ['Write report', 'Email accountant', 'Review pull request', 'Grocery run', 'Call Mum', 'Prepare slides', 'Fix the tap', 'Pay bills', 'Read chapter 4', 'Plan the week', 'Clean the kitchen', 'Update resume', 'Book flights', 'Gym session', 'Draft blog post']

function buildDay(i: number): PlanCase {
  const r = rng(1000 + i)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
  // Spread across the year, with both DST days included.
  const special: Record<number, LocalDate> = { 7: '2026-03-08', 8: '2026-11-01', 107: '2026-03-08', 108: '2026-11-01' }
  const date = special[i] ?? addDays('2026-01-05', Math.floor(i * 1.8))
  const at = (h: number, m = 0) => toInstant(date, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, ZONE).getTime()

  const busy = Array.from({ length: Math.floor(r() * 9) }, () => {
    const start = at(7) + Math.floor(r() * 56) * 15 * 60_000 // 07:00–20:45 on the quarter hour
    const len = pick([15, 30, 30, 45, 60, 60, 90, 120]) * 60_000
    return { start: new Date(start).toISOString(), end: new Date(start + len).toISOString() }
  })
  const notBefore = r() < 0.5 ? new Date(at(8 + Math.floor(r() * 4))).toISOString() : null
  const day: PlanDay = { date, zone: ZONE, window: { start: '07:00', end: '22:00' }, busy, notBefore }

  const overloaded = i % 7 === 3 // about 1 day in 7 gets far more work than fits
  const n = overloaded ? 10 + Math.floor(r() * 6) : 3 + Math.floor(r() * 8)
  const tasks: PlanTask[] = Array.from({ length: n }, (_, k) => {
    const roll = r()
    const dueDate = roll < 0.4 ? date : roll < 0.6 ? addDays(date, 1) : roll < 0.7 ? date : null
    const dueTime = roll >= 0.6 && roll < 0.7 ? pick(['12:00', '15:00', '17:00']) : null
    return {
      id: `t${k + 1}`,
      title: TITLES[(i + k) % TITLES.length]!,
      estimateMinutes: overloaded ? pick([90, 120, 180, 240]) : pick(ESTIMATES),
      priority: pick([1, 2, 2, 3, 3, 4, 4, 4] as const),
      dueDate,
      dueTime: dueDate === date ? dueTime : null,
    }
  })
  const free = freeSlots(day).reduce((s, g) => s + minutesOf(g), 0)
  const work = tasks.reduce((s, t) => s + Math.max(t.estimateMinutes, 15), 0)
  return { id: `day${String(i + 1).padStart(3, '0')}`, day, tasks, infeasible: work > free }
}

export const PLAN_CASES: PlanCase[] = Array.from({ length: 200 }, (_, i) => buildDay(i))
