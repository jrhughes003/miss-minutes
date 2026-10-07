// Reminder reliability tests (PLAN.md §5.3). Everything runs on a FakeClock,
// so "the laptop sleeps for three days" is one line, not three days.

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LocalReminderLog } from '../../storage/localReminderLog'
import { LocalTaskRepo, memoryStorage } from '../../storage/localRepo'
import { DAY, FakeClock, HOUR, MINUTE } from '../clock'
import { TaskService } from '../tasks/service'
import type { NewTask } from '../tasks/types'
import { addDays } from '../time'
import { ReminderEngine, type Notification } from './engine'
import { GRACE_MS } from './planner'
import { occurrenceOf } from './rules'

function setup(start = '2026-10-06T12:00:00Z', zone = 'America/Toronto') {
  const clock = new FakeClock(start, zone)
  let n = 0
  const tasks = new TaskService(new LocalTaskRepo(memoryStorage()), clock, () => `id${++n}`)
  const log = new LocalReminderLog(memoryStorage())
  const shown: Notification[] = []
  let changes = 0
  const engine = new ReminderEngine({ log, tasks, clock, notifier: { show: (x) => void shown.push(x) }, onChange: () => changes++ })
  const add = (input: NewTask) => tasks.createTask(input)
  return { clock, tasks, log, engine, shown, add, changes: () => changes }
}

// 2026-10-06T12:00Z is 08:00 in Toronto (EDT, UTC-4).
const at = (time: string, date = '2026-10-06') => ({ kind: 'at' as const, date, time })

describe('firing on time', () => {
  it('fires a reminder once when its time comes, and never again', () => {
    const { clock, engine, shown, add } = setup()
    add({ title: 'Call dentist', reminders: [{ when: at('09:00') }] })
    expect(engine.tick()).toEqual([])
    clock.advance(HOUR) // 09:00
    expect(engine.tick().map((f) => f.title)).toEqual(['Call dentist'])
    expect(shown).toEqual([expect.objectContaining({ title: 'Call dentist' })])
    clock.advance(30_000)
    expect(engine.tick()).toEqual([])
    expect(shown).toHaveLength(1)
  })

  it('fires "before due" reminders relative to the due time', () => {
    const { clock, engine, add } = setup()
    add({ title: 'Meeting', due: { date: '2026-10-06', time: '10:00' }, reminders: [{ when: { kind: 'beforeDue', minutes: 15 } }] })
    clock.set('2026-10-06T13:44:59Z') // 09:44:59
    expect(engine.tick()).toEqual([])
    clock.set('2026-10-06T13:45:00Z')
    expect(engine.tick()).toHaveLength(1)
  })

  it('does not fire for a time that had already passed when the reminder was set', () => {
    const { clock, engine, add } = setup()
    add({ title: 'Too late', reminders: [{ when: at('07:00') }] }) // it's 08:00
    clock.advance(DAY)
    expect(engine.tick()).toEqual([])
  })

  it('does not fire for done tasks', () => {
    const { clock, engine, add, tasks } = setup()
    const t = add({ title: 'Already done', reminders: [{ when: at('09:00') }] })
    tasks.completeTask(t.id)
    clock.advance(2 * HOUR)
    expect(engine.tick()).toEqual([])
  })

  it('groups many simultaneous reminders into one notification', () => {
    const { clock, engine, shown, add } = setup()
    for (const t of ['a', 'b', 'c', 'd', 'e']) add({ title: t, reminders: [{ when: at('09:00') }] })
    clock.advance(HOUR)
    expect(engine.tick()).toHaveLength(5)
    expect(shown).toEqual([expect.objectContaining({ title: '5 reminders' })])
    expect(shown[0]!.body).toContain('…and 1 more')
  })
})

describe('sleep, restarts and catch-up', () => {
  it('collects reminders missed during sleep into one summary, shown once', () => {
    const { clock, engine, shown, add } = setup()
    add({ title: 'One', reminders: [{ when: at('09:00') }] })
    add({ title: 'Two', reminders: [{ when: at('10:00') }] })
    add({ title: 'Three', reminders: [{ when: at('11:00') }] })
    clock.advance(3 * DAY) // asleep: no ticks at all
    const fired = engine.tick()
    expect(fired).toHaveLength(3)
    expect(fired.every((f) => f.late)).toBe(true)
    expect(shown).toEqual([expect.objectContaining({ title: 'You missed 3 reminders' })])
    expect(engine.tick()).toEqual([])
  })

  it('labels a single missed reminder', () => {
    const { clock, engine, shown, add } = setup()
    add({ title: 'Lonely', reminders: [{ when: at('09:00') }] })
    clock.advance(HOUR + GRACE_MS + 1)
    engine.tick()
    expect(shown[0]!.title).toBe('Missed: Lonely')
  })

  it('counts a fire within the grace period as on time', () => {
    const { clock, engine, add } = setup()
    add({ title: 'x', reminders: [{ when: at('09:00') }] })
    clock.advance(HOUR + GRACE_MS)
    expect(engine.tick()[0]!.late).toBe(false)
  })

  it('does not repeat after a restart (a new engine over the same log)', () => {
    const s = setup()
    s.add({ title: 'x', reminders: [{ when: at('09:00') }] })
    s.clock.advance(HOUR)
    s.engine.tick()
    const restarted = new ReminderEngine({ log: s.log, tasks: s.tasks, clock: s.clock, notifier: { show: () => { throw new Error('should not notify') } } })
    expect(restarted.tick()).toEqual([])
  })
})

describe('time zones and DST', () => {
  it('fires a 02:30 reminder on spring-forward day at 03:30 (the gap rule)', () => {
    const { clock, engine, add } = setup('2026-03-08T05:00:00Z') // 00:00 EST
    add({ title: 'x', reminders: [{ when: at('02:30', '2026-03-08') }] })
    clock.set('2026-03-08T07:29:59Z') // 03:29:59 EDT
    expect(engine.tick()).toEqual([])
    clock.set('2026-03-08T07:30:00Z') // 03:30 EDT
    expect(engine.tick()).toHaveLength(1)
  })

  it('fires a 01:30 reminder once on fall-back day, not twice', () => {
    const { clock, engine, add } = setup('2026-11-01T04:00:00Z') // 00:00 EDT
    add({ title: 'x', reminders: [{ when: at('01:30', '2026-11-01') }] })
    clock.set('2026-11-01T05:30:00Z') // first 01:30 (EDT)
    expect(engine.tick()).toHaveLength(1)
    clock.set('2026-11-01T06:30:00Z') // second 01:30 (EST)
    expect(engine.tick()).toEqual([])
  })

  it('does not fire again after moving to a later time zone', () => {
    const { clock, engine, add } = setup()
    add({ title: 'x', reminders: [{ when: at('09:00') }] })
    clock.advance(HOUR) // 09:00 Toronto: fires
    expect(engine.tick()).toHaveLength(1)
    clock.setZone('America/Vancouver') // now 06:00 there; 09:00 Vancouver comes 3 h later
    clock.advance(3 * HOUR)
    expect(engine.tick()).toEqual([])
  })
})

describe('acting on reminders', () => {
  it('lists fired reminders as active until acted on', () => {
    const { clock, engine, add } = setup()
    add({ title: 'x', reminders: [{ when: at('09:00') }] })
    clock.advance(HOUR)
    engine.tick()
    expect(engine.active()).toEqual([expect.objectContaining({ title: 'x', late: false })])
    const a = engine.active()[0]!
    engine.act(a.ruleId, a.occurrenceLocal, { kind: 'dismiss' })
    expect(engine.active()).toEqual([])
  })

  it('snoozes for N minutes and fires again exactly once', () => {
    const { clock, engine, shown, add } = setup()
    add({ title: 'Stretch', reminders: [{ when: at('09:00') }] })
    clock.advance(HOUR)
    engine.tick()
    const a = engine.active()[0]!
    engine.act(a.ruleId, a.occurrenceLocal, { kind: 'snooze', choice: { kind: 'minutes', minutes: 10 } })
    expect(engine.active()).toEqual([])
    clock.advance(9 * MINUTE)
    expect(engine.tick()).toEqual([])
    clock.advance(MINUTE)
    expect(engine.tick()).toHaveLength(1)
    clock.advance(MINUTE)
    expect(engine.tick()).toEqual([])
    expect(shown).toHaveLength(2)
    expect(engine.active()).toHaveLength(1)
  })

  it('snoozes until tomorrow at the all-day reminder time, local', () => {
    const { clock, engine, add } = setup()
    add({ title: 'x', reminders: [{ when: at('22:00') }] })
    clock.set('2026-10-07T02:00:00Z') // 22:00 local on the 6th
    engine.tick()
    const a = engine.active()[0]!
    engine.act(a.ruleId, a.occurrenceLocal, { kind: 'snooze', choice: { kind: 'tomorrow' } })
    clock.set('2026-10-07T12:59:00Z') // 08:59 on the 7th
    expect(engine.tick()).toEqual([])
    clock.set('2026-10-07T13:00:00Z') // 09:00 on the 7th
    expect(engine.tick()).toHaveLength(1)
  })

  it('marks the task done from the reminder, settling all its reminders', () => {
    const { clock, engine, add, tasks } = setup()
    const t = add({ title: 'Pay rent', reminders: [{ when: at('09:00') }, { when: at('09:05') }] })
    clock.advance(HOUR + 10 * MINUTE)
    engine.tick()
    const a = engine.active()[0]!
    engine.act(a.ruleId, a.occurrenceLocal, { kind: 'done' })
    expect(tasks.getTask(t.id)?.status).toBe('done')
    expect(engine.active()).toEqual([])
  })

  it('rejects invalid snoozes and actions on reminders that never fired', () => {
    const { engine } = setup()
    expect(() => engine.act('nope', 'x', { kind: 'dismiss' })).toThrow(/not fired/)
    expect(() => engine.snoozeUntil({ kind: 'minutes', minutes: 0 })).toThrow()
    expect(() => engine.snoozeUntil({ kind: 'until', instant: '2000-01-01T00:00:00Z' })).toThrow(/future/)
    expect(engine.snoozeUntil({ kind: 'until', instant: '2030-01-01T00:00:00Z' }).toISOString()).toBe('2030-01-01T00:00:00.000Z')
  })

  it('carries "before due" reminders to the next occurrence of a repeating task', () => {
    const { clock, engine, add, tasks } = setup()
    const t = add({
      title: 'Bins',
      due: { date: '2026-10-06', time: '19:00' },
      recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY' },
      reminders: [{ when: { kind: 'beforeDue', minutes: 60 } }, { when: at('10:00') }],
    })
    clock.set('2026-10-06T22:00:00Z') // 18:00: the before-due reminder fires
    expect(engine.tick()).toHaveLength(2) // plus the 10:00 one, late
    const { next } = tasks.completeTask(t.id)
    expect(next!.reminders.map((r) => r.when.kind)).toEqual(['beforeDue'])
    clock.set('2026-10-13T22:00:00Z') // a week later, 18:00
    expect(engine.tick().map((f) => f.taskId)).toEqual([next!.id])
  })

  it('re-arms reminders when a task is moved, without firing for the past', () => {
    const { clock, engine, add, tasks } = setup()
    const t = add({ title: 'x', due: { date: '2026-10-06', time: '12:00' }, reminders: [{ when: { kind: 'beforeDue', minutes: 0 } }] })
    clock.advance(2 * HOUR) // 10:00
    tasks.updateTask(t.id, { due: { date: '2026-10-06', time: '09:00' } }) // moved into the past
    clock.advance(4 * HOUR)
    expect(engine.tick()).toEqual([])
    tasks.updateTask(t.id, { due: { date: '2026-10-06', time: '15:00' } }) // and into the future
    clock.set('2026-10-06T19:00:00Z') // 15:00
    expect(engine.tick()).toHaveLength(1)
  })
})

describe('property: no duplicates, nothing lost (PLAN.md §5.3)', () => {
  // A random week of reminders, a random walk of the clock through it, with
  // long sleeps (no ticks), occasional zone changes, and DST zones included.
  const scenario = fc.record({
    zone: fc.constantFrom('America/Toronto', 'Europe/London', 'Australia/Lord_Howe', 'UTC'),
    start: fc.constantFrom('2026-03-06T00:00:00Z', '2026-10-30T00:00:00Z', '2026-04-02T00:00:00Z', '2026-06-15T00:00:00Z'),
    reminders: fc.array(
      fc.record({
        day: fc.integer({ min: 0, max: 5 }),
        hour: fc.integer({ min: 0, max: 23 }),
        minute: fc.constantFrom(0, 15, 30, 45),
        offset: fc.option(fc.constantFrom(0, 10, 60, 1440), { nil: undefined }),
      }),
      { minLength: 1, maxLength: 12 },
    ),
    steps: fc.array(
      fc.oneof(
        { weight: 8, arbitrary: fc.constant({ kind: 'tick' as const, ms: 30_000 }) },
        { weight: 2, arbitrary: fc.integer({ min: 1, max: 6 * 60 }).map((m) => ({ kind: 'tick' as const, ms: m * MINUTE })) },
        { weight: 1, arbitrary: fc.integer({ min: 1, max: 72 }).map((h) => ({ kind: 'sleep' as const, ms: h * HOUR })) },
        { weight: 1, arbitrary: fc.constantFrom('America/Toronto', 'America/Vancouver', 'Europe/London').map((z) => ({ kind: 'zone' as const, zone: z })) },
      ),
      { minLength: 20, maxLength: 200 },
    ),
  })

  it('every reminder that comes due fires exactly once, on time while awake', () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const s = setup(sc.start, sc.zone)
        const startDate = s.clock.now().toISOString().slice(0, 10)
        for (const r of sc.reminders) {
          const date = addDays(startDate, r.day + 1)
          const time = `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`
          if (r.offset === undefined) s.add({ title: 'x', reminders: [{ when: { kind: 'at', date, time } }] })
          else s.add({ title: 'x', due: { date, time }, reminders: [{ when: { kind: 'beforeDue', minutes: r.offset } }] })
        }

        const fires = new Map<string, number>()
        let awakeSince = s.clock.now().getTime()
        for (const step of sc.steps) {
          if (step.kind === 'zone') {
            // Moving east can make a wall-clock reminder that was still ahead
            // suddenly past; it then fires at once as "late", so the on-time
            // window restarts, as it does after sleep.
            s.clock.setZone(step.zone)
            awakeSince = Number.POSITIVE_INFINITY
            continue
          }
          s.clock.advance(step.ms)
          if (step.kind === 'sleep') {
            awakeSince = Number.POSITIVE_INFINITY // the next tick is a wake-up
            continue
          }
          const now = s.clock.now().getTime()
          for (const f of s.engine.tick()) {
            const key = `${f.ruleId}|${f.occurrenceLocal}`
            fires.set(key, (fires.get(key) ?? 0) + 1)
            // Awake for a whole tick before this one → it was not late by more than that tick.
            if (awakeSince <= now - step.ms) expect(now - f.fireFor.getTime()).toBeLessThanOrEqual(step.ms)
          }
          awakeSince = Math.min(awakeSince, now)
        }

        // Wake up one last time: anything that came due during a final sleep fires now.
        for (const f of s.engine.tick()) {
          const key = `${f.ruleId}|${f.occurrenceLocal}`
          fires.set(key, (fires.get(key) ?? 0) + 1)
        }

        // 1. No duplicates, and a further tick finds nothing new.
        for (const count of fires.values()) expect(count).toBe(1)
        expect(s.engine.tick()).toEqual([])
        // 2. Nothing lost: every occurrence that is due by now (and was scheduled
        //    before it came due) has fired.
        const now = s.clock.now()
        for (const task of s.tasks.listTasks({ status: 'open', includeSubtasks: true })) {
          for (const rule of task.reminders) {
            const occ = occurrenceOf(rule, task.due, s.clock.zone())!
            if (occ.instant <= now && occ.instant.getTime() >= Date.parse(rule.scheduledAt)) {
              expect(fires.has(`${rule.id}|${occ.local}`), `lost ${occ.local}`).toBe(true)
            }
          }
        }
        // 3. Every fire is in the log, and the log holds nothing else.
        expect(s.log.all().length).toBe(fires.size)
      }),
      // 300 runs in everyday test runs; the pre-registered check (PLAN.md 5.3)
      // is 10,000: MM_PROPERTY_RUNS=10000 npm test -- engine
      { numRuns: Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MM_PROPERTY_RUNS ?? 300) },
    )
  }, 30 * 60_000)
})
