// The validator's rules, one per test, in plain words. These are the cases to
// walk through when explaining it. The property test at the end ties it to
// the greedy planner: the planner must never produce a plan this rejects.

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { greedyPlan } from './greedy'
import { freeSlots, mergeIntervals } from './slots'
import type { PlanDay, PlanTask } from './types'
import { overlaps, validatePlan } from './validate'

// Wednesday 2026-10-07 in Toronto (UTC-4): 07:00 local = 11:00Z, 22:00 local = 02:00Z next day.
const Z = (hhmm: string, day = '07') => `2026-10-${day}T${hhmm}:00.000Z`
const day = (o: Partial<PlanDay> = {}): PlanDay => ({
  date: '2026-10-07', zone: 'America/Toronto', window: { start: '07:00', end: '22:00' },
  busy: [{ start: Z('14:00'), end: Z('15:00') }], // a 10:00–11:00 meeting
  notBefore: null, ...o,
})
const task = (o: Partial<PlanTask> = {}): PlanTask => ({ id: 't1', title: 'Write report', estimateMinutes: 60, priority: 2, dueDate: null, dueTime: null, ...o })
const kinds = (r: ReturnType<typeof validatePlan>) => r.violations.map((v) => v.kind)

describe('overlaps', () => {
  it('uses half-open intervals: touching ends do not overlap', () => {
    expect(overlaps({ start: Z('10:00'), end: Z('11:00') }, { start: Z('11:00'), end: Z('12:00') })).toBe(false)
    expect(overlaps({ start: Z('10:00'), end: Z('11:01') }, { start: Z('11:00'), end: Z('12:00') })).toBe(true)
  })
})

describe('validatePlan', () => {
  it('accepts a sensible plan', () => {
    const plan = { blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('16:00') }], unscheduled: [] }
    expect(validatePlan(plan, [task()], day())).toEqual({ ok: true, violations: [] })
  })

  it('1. rejects unknown and duplicated tasks', () => {
    const r = validatePlan({ blocks: [{ taskId: 'tX', start: Z('15:00'), end: Z('16:00') }, { taskId: 't1', start: Z('16:00'), end: Z('17:00') }, { taskId: 't1', start: Z('17:00'), end: Z('18:00') }], unscheduled: [] }, [task()], day())
    expect(kinds(r)).toEqual(expect.arrayContaining(['unknown-task', 'duplicate-task']))
  })

  it('2. rejects blocks shorter than 15 minutes, and malformed ones', () => {
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('15:10') }], unscheduled: [] }, [task()], day()))).toContain('too-short')
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: Z('16:00'), end: Z('15:00') }], unscheduled: [] }, [task()], day()))).toContain('malformed')
  })

  it('3. rejects blocks outside the window, or before now', () => {
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: Z('10:00'), end: Z('11:00') }], unscheduled: [] }, [task()], day()))).toContain('outside-window') // 06:00 local
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('16:00') }], unscheduled: [] }, [task()], day({ notBefore: Z('15:30') })))).toContain('before-now')
  })

  it('4. rejects blocks overlapping a calendar event', () => {
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: Z('14:30'), end: Z('15:30') }], unscheduled: [] }, [task()], day()))).toEqual(['overlaps-busy'])
  })

  it('5. rejects two tasks at the same time', () => {
    const tasks = [task(), task({ id: 't2', title: 'Email' })]
    const r = validatePlan({ blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('16:00') }, { taskId: 't2', start: Z('15:30'), end: Z('16:00') }], unscheduled: [] }, tasks, day())
    expect(kinds(r)).toContain('overlaps-block')
  })

  it('6. rejects finishing after the deadline (due time, or end of the due day)', () => {
    const due = task({ dueDate: '2026-10-07', dueTime: '12:00' }) // 16:00Z
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: Z('15:30'), end: Z('16:30') }], unscheduled: [] }, [due], day()))).toContain('after-deadline')
    expect(validatePlan({ blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('16:00') }], unscheduled: [] }, [due], day()).ok).toBe(true)
  })

  it('7. rejects far more time than the estimate, but never asks for less than 15 minutes', () => {
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('17:00') }], unscheduled: [] }, [task({ estimateMinutes: 60 })], day()))).toContain('over-estimate')
    expect(validatePlan({ blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('15:15') }], unscheduled: [] }, [task({ estimateMinutes: 5 })], day()).ok).toBe(true)
  })

  it('8. rejects a plan that silently drops a candidate', () => {
    const tasks = [task(), task({ id: 't2', title: 'Email' })]
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('16:00') }], unscheduled: [] }, tasks, day()))).toEqual(['missing-task'])
    expect(validatePlan({ blocks: [{ taskId: 't1', start: Z('15:00'), end: Z('16:00') }], unscheduled: ['t2'] }, tasks, day()).ok).toBe(true)
  })

  it('knows a DST day is 23 or 25 hours: the window is wall-clock', () => {
    // 2026-11-01 (fall back): 07:00 local is 12:00Z (EST), and 22:00 local is 03:00Z next day.
    const fallBack = day({ date: '2026-11-01', busy: [] })
    expect(validatePlan({ blocks: [{ taskId: 't1', start: '2026-11-01T12:00:00.000Z', end: '2026-11-01T13:00:00.000Z' }], unscheduled: [] }, [task()], fallBack).ok).toBe(true)
    expect(kinds(validatePlan({ blocks: [{ taskId: 't1', start: '2026-11-01T11:00:00.000Z', end: '2026-11-01T12:00:00.000Z' }], unscheduled: [] }, [task()], fallBack))).toContain('outside-window')
  })
})

describe('free slots', () => {
  it('subtracts merged busy time from the window, after now, dropping slivers under 15 minutes', () => {
    const d = day({ busy: [{ start: Z('14:00'), end: Z('15:00') }, { start: Z('14:30'), end: Z('15:10') }, { start: Z('15:20'), end: Z('16:00') }], notBefore: Z('12:00') })
    expect(freeSlots(d)).toEqual([
      { start: Z('12:00'), end: Z('14:00') },
      { start: Z('16:00'), end: '2026-10-08T02:00:00.000Z' },
    ]) // 15:10–15:20 is a 10-minute sliver: dropped
    expect(mergeIntervals([{ start: Z('10:00'), end: Z('11:00') }, { start: Z('11:00'), end: Z('12:00') }])).toEqual([{ start: Z('10:00'), end: Z('12:00') }])
  })
})

describe('property: the greedy planner never produces a plan the validator rejects', () => {
  const taskArb = fc.record({
    estimateMinutes: fc.constantFrom(5, 15, 30, 45, 60, 90, 120, 240),
    priority: fc.constantFrom(1, 2, 3, 4) as fc.Arbitrary<1 | 2 | 3 | 4>,
    dueDate: fc.constantFrom(null, '2026-10-07', '2026-10-08'),
    dueTime: fc.constantFrom(null, '12:00', '18:00'),
  })
  const busyArb = fc.array(fc.tuple(fc.integer({ min: 0, max: 15 * 4 }), fc.integer({ min: 1, max: 12 })), { maxLength: 10 })

  it('holds over random days', () => {
    fc.assert(
      fc.property(fc.array(taskArb, { minLength: 1, maxLength: 15 }), busyArb, fc.option(fc.integer({ min: 0, max: 15 * 4 })), (ts, busy, nowQ) => {
        const start = Date.parse(Z('11:00'))
        const tasks = ts.map((x, i) => ({ ...x, id: `t${i + 1}`, title: `Task ${i + 1}`, dueTime: x.dueDate ? x.dueTime : null }))
        const d = day({
          busy: busy.map(([q, len]) => ({ start: new Date(start + q * 15 * 60_000).toISOString(), end: new Date(start + (q + len) * 15 * 60_000).toISOString() })),
          notBefore: nowQ === null ? null : new Date(start + nowQ * 15 * 60_000).toISOString(),
        })
        const r = validatePlan(greedyPlan(tasks, d), tasks, d)
        expect(r.violations).toEqual([])
      }),
      { numRuns: 1000 },
    )
  })
})
