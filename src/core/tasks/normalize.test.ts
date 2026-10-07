// The input gate every write passes through: from the UI, over IPC, and later
// from AI capture and Google sync. These tests feed it the malformed values
// those paths could produce.
import { describe, expect, it } from 'vitest'
import {
  LIMITS,
  normalizeColor,
  normalizeDue,
  normalizeEstimate,
  normalizeNotes,
  normalizeProjectName,
  normalizeRecurrence,
  normalizeTags,
  normalizeTitle,
  PROJECT_COLORS,
  ValidationError,
} from './normalize'

const fails = (fn: () => unknown, field: string) => {
  expect(fn).toThrow(ValidationError)
  try {
    fn()
  } catch (e) {
    expect((e as ValidationError).field).toBe(field)
  }
}

describe('normalize', () => {
  it('title: must be non-empty text within the Google Tasks limit', () => {
    fails(() => normalizeTitle(undefined), 'title')
    fails(() => normalizeTitle(42), 'title')
    expect(normalizeTitle('x'.repeat(LIMITS.title))).toHaveLength(LIMITS.title)
  })

  it('notes: optional text within the limit, trailing whitespace trimmed', () => {
    expect(normalizeNotes(null)).toBe('')
    expect(normalizeNotes('keep\n  indent\n\n')).toBe('keep\n  indent')
    fails(() => normalizeNotes(5), 'notes')
    fails(() => normalizeNotes('x'.repeat(LIMITS.notes + 1)), 'notes')
  })

  it('tags: a list of short words; blanks dropped, limits enforced', () => {
    expect(normalizeTags(null)).toEqual([])
    expect(normalizeTags(['', '#', '  ', 'été'])).toEqual(['été'])
    fails(() => normalizeTags('home'), 'tags')
    fails(() => normalizeTags([1]), 'tags')
    fails(() => normalizeTags(['x'.repeat(LIMITS.tag + 1)]), 'tags')
    fails(() => normalizeTags(Array.from({ length: LIMITS.tagsPerTask + 1 }, (_, i) => `t${i}`)), 'tags')
  })

  it('due: an object with a real date and an optional HH:mm time', () => {
    expect(normalizeDue({ date: '2026-10-06' })).toEqual({ date: '2026-10-06', time: null })
    fails(() => normalizeDue('2026-10-06'), 'due')
    fails(() => normalizeDue({ date: '2026-10-06', time: '25:00' }), 'due')
  })

  it('estimate: whole minutes from 1 to 24 hours', () => {
    expect(normalizeEstimate(undefined)).toBeNull()
    expect(normalizeEstimate(LIMITS.estimateMinutes)).toBe(LIMITS.estimateMinutes)
    fails(() => normalizeEstimate('30'), 'estimateMinutes')
    fails(() => normalizeEstimate(2.5), 'estimateMinutes')
    fails(() => normalizeEstimate(LIMITS.estimateMinutes + 1), 'estimateMinutes')
  })

  it('recurrence: must be a valid object, and copied rather than shared', () => {
    fails(() => normalizeRecurrence('FREQ=DAILY', { date: '2026-10-06', time: null }), 'recurrence')
    const input = { kind: 'afterCompletion' as const, every: 2, unit: 'day' as const }
    const out = normalizeRecurrence(input, { date: '2026-10-06', time: null })
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
  })

  it('project names and colours', () => {
    fails(() => normalizeProjectName(''), 'name')
    fails(() => normalizeProjectName('x'.repeat(LIMITS.projectName + 1)), 'name')
    expect(normalizeProjectName('  Work ')).toBe('Work')
    expect(normalizeColor('red', 0)).toBe(PROJECT_COLORS[0])
    expect(normalizeColor(undefined, PROJECT_COLORS.length + 1)).toBe(PROJECT_COLORS[1])
  })
})
