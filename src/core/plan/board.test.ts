import { describe, expect, it } from 'vitest'
import { autoArrange, checkBoard, endOf, newItem, nudge, place, placeOne, resize, toProposal, unplace } from './board'
import type { PlanDay } from './types'

// Thursday 2026-10-08 in Toronto (UTC-4): 07:00 local = 11:00Z.
const Z = (hhmm: string) => `2026-10-08T${hhmm}:00.000Z`
const day: PlanDay = { date: '2026-10-08', zone: 'America/Toronto', window: { start: '07:00', end: '22:00' }, busy: [{ start: Z('13:00'), end: Z('14:00') }], notBefore: null }

describe('board', () => {
  it('snaps placement to 15 minutes and computes ends', () => {
    const items = place([newItem('a', 'Report', 60)], 'a', '2026-10-08T15:07:00.000Z')
    expect(items[0]!.start).toBe(Z('15:00'))
    expect(endOf(items[0]!)).toBe(Z('16:00'))
  })

  it('nudges by 15-minute steps and resizes with a 15-minute floor', () => {
    let items = place([newItem('a', 'Report', 60)], 'a', Z('15:00'))
    items = nudge(items, 'a', 2)
    expect(items[0]!.start).toBe(Z('15:30'))
    expect(resize(items, 'a', 50)[0]!.minutes).toBe(45)
    expect(resize(items, 'a', 5)[0]!.minutes).toBe(15)
    expect(unplace(items, 'a')[0]!.start).toBeNull()
  })

  it('auto-arranges the tray around calendar events and hand-placed items', () => {
    let items = [newItem('a', 'Pinned', 60), newItem('b', 'Report', 120), newItem('c', 'Email', 30)]
    items = place(items, 'a', Z('11:00')) // 07:00–08:00, placed by hand
    const arranged = autoArrange(items, day)
    expect(arranged.find((i) => i.key === 'a')!.start).toBe(Z('11:00')) // untouched
    expect(checkBoard(arranged, day).size).toBe(0)
    // Nothing overlaps the 09:00–10:00 meeting.
    const p = toProposal(arranged)
    expect(p.blocks.every((b) => b.end <= Z('13:00') || b.start >= Z('14:00'))).toBe(true)
  })

  it('leaves breaks between blocks and around events when asked', () => {
    const arranged = autoArrange([newItem('a', 'A', 60), newItem('b', 'B', 60)], { ...day, busy: [] }, 15)
    const [a, b] = toProposal(arranged).blocks
    expect(Date.parse(b!.start) - Date.parse(a!.end)).toBe(15 * 60_000)
  })

  it('keeps start times on the 15-minute grid when the break is shorter', () => {
    const arranged = autoArrange([newItem('a', 'A', 30), newItem('b', 'B', 30)], { ...day, busy: [] }, 10)
    expect(toProposal(arranged).blocks.map((b) => b.start)).toEqual([Z('11:00'), Z('11:45')])
  })

  it('places just one tray item on request', () => {
    const r = placeOne([newItem('a', 'A', 30), newItem('b', 'B', 30)], 'b', day)
    expect(r.find((i) => i.key === 'b')!.start).not.toBeNull()
    expect(r.find((i) => i.key === 'a')!.start).toBeNull()
  })

  it('leaves items in the tray when they do not fit', () => {
    const tight: PlanDay = { ...day, window: { start: '07:00', end: '08:00' } }
    const arranged = autoArrange([newItem('a', 'Big', 120)], tight)
    expect(arranged[0]!.start).toBeNull()
  })

  it('reports live violations per item, but not "unscheduled" for tray items', () => {
    let items = [newItem('a', 'Report', 60), newItem('b', 'Tray item', 30)]
    items = place(items, 'a', Z('13:30')) // overlaps the meeting
    const issues = checkBoard(items, day)
    expect(issues.get('a')!.map((v) => v.kind)).toEqual(['overlaps-busy'])
    expect(issues.has('b')).toBe(false)
  })

  it('defaults a missing estimate to 30 minutes, and a tiny one up to 15', () => {
    expect(newItem('x', 'A', null).minutes).toBe(30)
    expect(newItem('x', 'A', 5).minutes).toBe(15)
  })
})
