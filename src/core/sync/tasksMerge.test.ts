// The sync rules, one per test, in plain words. Read these to explain the merge.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decide, mergeFields, sameFields, shouldIntroduce, SYNC_FIELDS, type SyncFields } from './tasksMerge'

const base: SyncFields = { title: 'Call the dentist', notes: '', due: '2026-10-08', done: false }
const v = (o: Partial<SyncFields>): SyncFields => ({ ...base, ...o })

describe('mergeFields', () => {
  it('does nothing when neither side changed', () => {
    expect(mergeFields(base, base, base)).toEqual({ merged: base, conflicts: [], localChanges: {}, remoteChanges: {} })
  })

  it('takes a change made only in Google', () => {
    const m = mergeFields(base, base, v({ title: 'Call the dentist re: crown' }))
    expect(m.merged.title).toBe('Call the dentist re: crown')
    expect(m.localChanges).toEqual({ title: 'Call the dentist re: crown' })
    expect(m.remoteChanges).toEqual({})
  })

  it('pushes a change made only here', () => {
    const m = mergeFields(base, v({ due: '2026-10-09' }), base)
    expect(m.remoteChanges).toEqual({ due: '2026-10-09' })
    expect(m.localChanges).toEqual({})
  })

  it('keeps both edits when they touch different fields (rename on the phone, reschedule here)', () => {
    const m = mergeFields(base, v({ due: '2026-10-09' }), v({ title: 'Dentist' }))
    expect(m.merged).toEqual(v({ title: 'Dentist', due: '2026-10-09' }))
    expect(m.conflicts).toEqual([])
  })

  it('lets the local value win a same-field conflict, and records what Google had (D31)', () => {
    const m = mergeFields(base, v({ title: 'Local title' }), v({ title: 'Phone title' }))
    expect(m.merged.title).toBe('Local title')
    expect(m.conflicts).toEqual([{ field: 'title', kept: 'Local title', overwritten: 'Phone title' }])
    expect(m.remoteChanges).toEqual({ title: 'Local title' })
  })

  it('treats the same change on both sides as agreement, not a conflict', () => {
    const m = mergeFields(base, v({ done: true }), v({ done: true }))
    expect(m.conflicts).toEqual([])
    expect(m.localChanges).toEqual({})
    expect(m.remoteChanges).toEqual({})
  })
})

describe('decide', () => {
  it('updates when either side changed', () => {
    expect(decide(base, v({ notes: 'x' }), { kind: 'unchanged' })).toMatchObject({ kind: 'update', merge: { remoteChanges: { notes: 'x' } } })
    expect(decide(base, base, { kind: 'present', fields: v({ done: true }) })).toMatchObject({ kind: 'update', merge: { localChanges: { done: true } } })
  })

  it('does nothing when Google reports a task that still matches', () => {
    expect(decide(base, base, { kind: 'present', fields: base })).toEqual({ kind: 'none' })
  })

  it('deleted in Google, untouched here → delete here', () => {
    expect(decide(base, base, { kind: 'deleted' })).toEqual({ kind: 'deleteLocal' })
  })

  it('deleted in Google, edited here → keep the edit and re-create it in Google', () => {
    expect(decide(base, v({ title: 'Edited' }), { kind: 'deleted' })).toEqual({ kind: 'recreateRemote' })
  })

  it('deleted here, untouched in Google → delete in Google', () => {
    expect(decide(base, null, { kind: 'unchanged' })).toEqual({ kind: 'deleteRemote' })
    expect(decide(base, null, { kind: 'present', fields: base })).toEqual({ kind: 'deleteRemote' })
  })

  it('deleted here, edited in Google → bring it back here', () => {
    expect(decide(base, null, { kind: 'present', fields: v({ due: null }) })).toEqual({ kind: 'recreateLocal', fields: v({ due: null }) })
  })

  it('deleted on both sides → just forget it', () => {
    expect(decide(base, null, { kind: 'deleted' })).toEqual({ kind: 'forget' })
  })
})

describe('shouldIntroduce', () => {
  it('only introduces open tasks to the other side', () => {
    expect(shouldIntroduce(base)).toBe(true)
    expect(shouldIntroduce(v({ done: true }))).toBe(false)
  })
})

describe('properties of the merge', () => {
  const fields = fc.record({
    title: fc.constantFrom('A', 'B', 'C'),
    notes: fc.constantFrom('', 'n1', 'n2'),
    due: fc.constantFrom(null, '2026-10-08', '2026-10-09'),
    done: fc.boolean(),
  })

  it('never loses a one-sided change, and applying the changes makes both sides equal', () => {
    fc.assert(
      fc.property(fields, fields, fields, (b, l, r) => {
        const m = mergeFields(b, l, r)
        const localAfter = { ...l, ...m.localChanges }
        const remoteAfter = { ...r, ...m.remoteChanges }
        expect(sameFields(localAfter, m.merged)).toBe(true)
        expect(sameFields(remoteAfter, m.merged)).toBe(true)
        for (const f of SYNC_FIELDS) {
          if (l[f] === b[f] && r[f] !== b[f]) expect(m.merged[f]).toBe(r[f]) // Google's lone change survives
          if (r[f] === b[f] && l[f] !== b[f]) expect(m.merged[f]).toBe(l[f]) // our lone change survives
          if (l[f] !== b[f] && r[f] !== b[f] && l[f] !== r[f]) expect(m.conflicts.some((c) => c.field === f)).toBe(true)
        }
      }),
      { numRuns: 2000 },
    )
  })

  it('is stable: merging an already-merged state changes nothing', () => {
    fc.assert(
      fc.property(fields, fields, fields, (b, l, r) => {
        const { merged } = mergeFields(b, l, r)
        const again = mergeFields(merged, merged, merged)
        expect(again.localChanges).toEqual({})
        expect(again.remoteChanges).toEqual({})
      }),
    )
  })
})
