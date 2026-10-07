import { endOfLocalDay, toInstant } from '../time'
import type { PlanTask } from './types'

/**
 * The instant a task must be finished by: its due time if it has one,
 * otherwise the end of its due date (local), or null with no due date.
 */
export function deadlineOf(t: PlanTask, zone: string): string | null {
  if (!t.dueDate) return null
  return (t.dueTime ? toInstant(t.dueDate, t.dueTime, zone) : endOfLocalDay(t.dueDate, zone)).toISOString()
}
