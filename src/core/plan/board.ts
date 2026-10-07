// The planning board behind "Plan my day": the items you want to do, and
// where (if anywhere) each sits on the day's timeline.
//
// Pure functions only. The UI calls them for every drag, resize, keyboard
// nudge and "Auto-arrange", and the validator checks the result live. All
// times snap to a 15-minute grid, so blocks line up with the hour lines and
// never produce slivers.

import { greedyPlan } from './greedy'
import { minutesOf } from './slots'
import { DEFAULT_ESTIMATE, MIN_BLOCK_MINUTES, type PlanDay, type PlanProposal, type PlanTask } from './types'
import { validatePlan, type Violation } from './validate'

export const SNAP_MINUTES = 15

export interface BoardItem {
  /** Stable key: the existing task's id, or "new-N" for a brain-dump line. */
  key: string
  title: string
  minutes: number
  priority: PlanTask['priority']
  dueDate: string | null
  dueTime: string | null
  /** Set when the item is an existing task (it will be updated, not created). */
  taskId: string | null
  tags: string[]
  /** Start instant when placed on the timeline; null while in the tray. */
  start: string | null
}

const MIN = 60_000
const snap = (ms: number) => Math.round(ms / (SNAP_MINUTES * MIN)) * SNAP_MINUTES * MIN

export const endOf = (i: BoardItem) => (i.start ? new Date(Date.parse(i.start) + i.minutes * MIN).toISOString() : null)

export function toPlanTask(i: BoardItem): PlanTask {
  return { id: i.key, title: i.title, estimateMinutes: i.minutes, priority: i.priority, dueDate: i.dueDate, dueTime: i.dueTime }
}

export function toProposal(items: BoardItem[]): PlanProposal {
  return {
    blocks: items.filter((i) => i.start).map((i) => ({ taskId: i.key, start: i.start!, end: endOf(i)! })),
    unscheduled: items.filter((i) => !i.start).map((i) => i.key),
  }
}

const update = (items: BoardItem[], key: string, f: (i: BoardItem) => BoardItem) => items.map((i) => (i.key === key ? f(i) : i))

/** Places (or moves) an item to start at `start`, snapped to the grid. */
export function place(items: BoardItem[], key: string, start: string): BoardItem[] {
  return update(items, key, (i) => ({ ...i, start: new Date(snap(Date.parse(start))).toISOString() }))
}

/** Moves a placed item by whole snap steps (keyboard: ↑ / ↓). */
export function nudge(items: BoardItem[], key: string, steps: number): BoardItem[] {
  return update(items, key, (i) => (i.start ? { ...i, start: new Date(Date.parse(i.start) + steps * SNAP_MINUTES * MIN).toISOString() } : i))
}

/** Changes an item's length, in snap steps, never below the 15-minute minimum. */
export function resize(items: BoardItem[], key: string, minutes: number): BoardItem[] {
  const m = Math.max(MIN_BLOCK_MINUTES, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES)
  return update(items, key, (i) => ({ ...i, minutes: m }))
}

export function unplace(items: BoardItem[], key: string): BoardItem[] {
  return update(items, key, (i) => ({ ...i, start: null }))
}

/**
 * Fills the gaps with the items still in the tray, leaving everything you
 * placed by hand where it is: placed items count as busy time for the rest.
 */
export function autoArrange(items: BoardItem[], day: PlanDay, bufferMinutes = 0): BoardItem[] {
  const pinned = items.filter((i) => i.start).map((i) => ({ start: i.start!, end: endOf(i)! }))
  const tray = items.filter((i) => !i.start)
  const plan = greedyPlan(tray.map(toPlanTask), { ...day, busy: [...day.busy, ...pinned] }, { bufferMinutes, snapMinutes: SNAP_MINUTES })
  return items.map((i) => {
    const b = plan.blocks.find((x) => x.taskId === i.key)
    // Greedy uses the item's own length, snapped up so blocks stay on the grid.
    return b ? { ...i, start: b.start, minutes: Math.max(i.minutes, Math.round(minutesOf(b))) } : i
  })
}

/** Places one tray item in the earliest gap that fits it, leaving the rest of the tray alone. */
export function placeOne(items: BoardItem[], key: string, day: PlanDay, bufferMinutes = 0): BoardItem[] {
  const others = items.filter((i) => i.key !== key && !i.start)
  const placed = autoArrange(items.filter((i) => i.key === key || i.start), day, bufferMinutes)
  return items.map((i) => (others.includes(i) ? i : placed.find((p) => p.key === i.key) ?? i))
}

/** Live check of the board: violations per item key (and for the plan as a whole under ''). */
export function checkBoard(items: BoardItem[], day: PlanDay): Map<string, Violation[]> {
  const result = validatePlan(toProposal(items), items.map(toPlanTask), day)
  const out = new Map<string, Violation[]>()
  for (const v of result.violations) {
    if (v.kind === 'missing-task') continue // the tray is the "unscheduled" list
    const k = v.taskId ?? ''
    out.set(k, [...(out.get(k) ?? []), v])
  }
  return out
}

/** A board item from a brain-dump line, with defaults for anything unsaid. */
export function newItem(key: string, title: string, minutes: number | null, extra: Partial<BoardItem> = {}): BoardItem {
  return { key, title, minutes: Math.max(minutes ?? DEFAULT_ESTIMATE, MIN_BLOCK_MINUTES), priority: 4, dueDate: null, dueTime: null, taskId: null, tags: [], start: null, ...extra }
}
