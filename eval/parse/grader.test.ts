// Tests for the parse-eval grader. They double as its specification: each
// one states a grading rule in plain words, so these are the cases to walk
// through when explaining the grader.

import { describe, expect, it } from 'vitest'
import type { CaptureResult } from '../../src/core/capture/types'
import type { Expected, ParseCase } from './cases'
import { CASES } from './cases'
import { computeMetrics, gradeCase, recurrenceEquivalent, shipRule, titleF1, tokens, type Metrics } from './grader'

const exp = (o: Partial<Expected> = {}): Expected => ({
  kind: 'task', title: 'Call the dentist', due: { date: '2026-10-08', time: '15:00' }, priority: 4, projectName: null, tags: [], recurrence: null, reminderMinutesBefore: null, ...o,
})
const act = (o: Partial<CaptureResult> = {}): CaptureResult => ({
  kind: 'task', title: 'Call the dentist', due: { date: '2026-10-08', time: '15:00' }, priority: 4, projectName: null, tags: [], recurrence: null, reminderMinutesBefore: null, question: null, ...o,
})
const grade = (e: Expected, a: CaptureResult) => gradeCase({ id: 'x', expected: e }, a)

describe('titleF1', () => {
  it('scores identical titles 1, ignoring case and punctuation', () => {
    expect(titleF1('Call the dentist', 'call the dentist!')).toBe(1)
  })

  it('gives partial credit for an extra word (precision 3/4, recall 1 → F1 6/7)', () => {
    expect(titleF1('Call the dentist', 'Call the dentist Thursday')).toBeCloseTo(6 / 7)
  })

  it('gives partial credit for a missing word (precision 1, recall 2/3 → F1 0.8)', () => {
    expect(titleF1('Call the dentist', 'Call dentist')).toBeCloseTo(0.8)
  })

  it('scores no overlap 0, and counts repeated words only as often as they appear', () => {
    expect(titleF1('Call the dentist', 'Book flights')).toBe(0)
    expect(titleF1('the', 'the the')).toBeCloseTo(2 / 3)
  })

  it('handles empty titles', () => {
    expect(titleF1('', '')).toBe(1)
    expect(titleF1('Call', '')).toBe(0)
  })

  it('tokenizes unicode words', () => {
    expect(tokens('Café crème, s’il vous plaît')).toEqual(['café', 'crème', 's', 'il', 'vous', 'plaît'])
  })
})

describe('recurrenceEquivalent', () => {
  const anchor = { date: '2026-10-15', time: null }
  it('accepts differently written rules with the same dates', () => {
    expect(recurrenceEquivalent('FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=MONTHLY', anchor)).toBe(true)
    expect(recurrenceEquivalent('FREQ=WEEKLY;BYDAY=TH', 'RRULE:FREQ=WEEKLY', anchor)).toBe(true) // Oct 15 is a Thursday
  })
  it('rejects rules with different dates', () => {
    expect(recurrenceEquivalent('FREQ=WEEKLY;BYDAY=TH', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH', anchor)).toBe(false)
  })
  it('treats null as "doesn’t repeat"', () => {
    expect(recurrenceEquivalent(null, null, anchor)).toBe(true)
    expect(recurrenceEquivalent('FREQ=DAILY', null, anchor)).toBe(false)
  })
  it('marks an unparseable rule wrong instead of crashing', () => {
    expect(recurrenceEquivalent('FREQ=DAILY', 'FREQ=SOMETIMES', anchor)).toBe(false)
  })
})

describe('gradeCase', () => {
  it('passes an exactly right answer', () => {
    expect(grade(exp(), act())).toMatchObject({ correct: true, confidentlyWrong: false })
  })

  it('flags a wrong date given without a question as confidently wrong', () => {
    const r = grade(exp(), act({ due: { date: '2026-10-15', time: '15:00' } }))
    expect(r).toMatchObject({ correct: false, confidentlyWrong: true })
    expect(r.fields.due).toBe(false)
  })

  it('counts a missing time as a wrong due (all-day is not 15:00)', () => {
    expect(grade(exp(), act({ due: { date: '2026-10-08', time: null } })).confidentlyWrong).toBe(true)
  })

  it('fails a slightly-off title only below the F1 threshold', () => {
    expect(grade(exp(), act({ title: 'Call dentist' })).correct).toBe(true) // F1 0.8, at threshold
    expect(grade(exp(), act({ title: 'Dentist' })).correct).toBe(false) // F1 0.5
  })

  it('checks priority, project (case-insensitive), tags (order-free) and reminder', () => {
    const e = exp({ priority: 1, projectName: 'Work', tags: ['a', 'b'], reminderMinutesBefore: 30 })
    expect(grade(e, act({ priority: 1, projectName: 'work', tags: ['B', 'a'], reminderMinutesBefore: 30 })).correct).toBe(true)
    expect(grade(e, act({ priority: 2, projectName: 'Work', tags: ['a', 'b'], reminderMinutesBefore: 30 })).fields.priority).toBe(false)
    expect(grade(e, act({ priority: 1, projectName: null, tags: ['a', 'b'], reminderMinutesBefore: 30 })).fields.project).toBe(false)
    expect(grade(e, act({ priority: 1, projectName: 'Work', tags: ['a'], reminderMinutesBefore: 30 })).fields.tags).toBe(false)
    expect(grade(e, act({ priority: 1, projectName: 'Work', tags: ['a', 'b'], reminderMinutesBefore: 0 })).fields.reminder).toBe(false)
  })

  it('on an ambiguous case, asking is right and guessing is a missed clarification', () => {
    expect(grade({ kind: 'clarify' }, act({ kind: 'clarify', question: 'This Friday or next?' }))).toMatchObject({ correct: true, missedClarify: false })
    expect(grade({ kind: 'clarify' }, act())).toMatchObject({ correct: false, missedClarify: true, confidentlyWrong: false })
  })

  it('on an unambiguous case, asking is a false clarification, not "confidently wrong"', () => {
    expect(grade(exp(), act({ kind: 'clarify' }))).toMatchObject({ correct: false, falseClarify: true, confidentlyWrong: false })
  })
})

describe('computeMetrics and shipRule', () => {
  const cases = [
    { id: 'a', category: 'weekday', expected: exp() },
    { id: 'b', category: 'weekday', expected: exp() },
    { id: 'c', category: 'ambiguous', expected: { kind: 'clarify' } as Expected },
    { id: 'd', category: 'ambiguous', expected: { kind: 'clarify' } as Expected },
  ] as Pick<ParseCase, 'id' | 'expected' | 'category'>[]

  it('computes each metric over the right denominator', () => {
    const grades = [
      gradeCase(cases[0]!, act()), // correct
      gradeCase(cases[1]!, act({ due: null })), // confidently wrong
      gradeCase(cases[2]!, act({ kind: 'clarify' })), // asked: right
      gradeCase(cases[3]!, act()), // guessed: missed
    ]
    const m = computeMetrics(cases, grades)
    expect(m).toMatchObject({ cases: 4, unambiguous: 2, ambiguous: 2, fullyCorrect: 0.5, confidentlyWrong: 0.5, clarificationRecall: 0.5, falseClarification: 0 })
    expect(m.byCategory).toEqual({ weekday: { cases: 2, correct: 1 }, ambiguous: { cases: 2, correct: 1 } })
    expect(m.fieldAccuracy.due).toBe(0.5)
  })

  it('refuses to compute metrics with a case left ungraded', () => {
    expect(() => computeMetrics(cases, [])).toThrow(/No grade/)
  })

  it('ships Claude only with a ≥ 10 pp margin and no more confident errors than the baseline', () => {
    const m = (fullyCorrect: number, confidentlyWrong: number) => ({ fullyCorrect, confidentlyWrong }) as Metrics
    expect(shipRule(m(0.95, 0.01), m(0.8, 0.05)).ship).toBe(true)
    expect(shipRule(m(0.85, 0.01), m(0.8, 0.05)).reasons[0]).toMatch(/margin/)
    expect(shipRule(m(0.99, 0.06), m(0.8, 0.05)).reasons).toEqual(['confidently wrong more often than the baseline'])
  })
})

describe('the frozen case set', () => {
  it('has unique ids, a valid split for each case, and both splits about half', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length)
    const dev = CASES.filter((c) => c.split === 'dev').length
    expect(dev / CASES.length).toBeGreaterThan(0.4)
    expect(dev / CASES.length).toBeLessThan(0.6)
  })

  it('grades a perfect answer to every unambiguous case as correct (the expectations are self-consistent)', () => {
    for (const c of CASES.filter((x) => x.expected.kind === 'task')) {
      const e = c.expected
      const perfect = act({ title: e.title!, due: e.due ?? null, priority: e.priority ?? 4, projectName: e.projectName ?? null, tags: e.tags ?? [], recurrence: e.recurrence ?? null, reminderMinutesBefore: e.reminderMinutesBefore ?? null })
      expect(gradeCase(c, perfect).correct, c.id).toBe(true)
    }
  })
})
