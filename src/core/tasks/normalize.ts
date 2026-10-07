// Input checking for tasks and projects. Every write goes through here, from
// the UI, from IPC and (later) from AI capture and Google sync, so the stored
// data always meets the same rules whichever path it came by.
//
// Limits match Google Tasks where one exists (title 1024 chars, notes 8192
// chars), so a task created here can always be synced (D13).

import { validateRecurrence, type Due, type Recurrence } from '../recurrence'
import { isLocalDate, isLocalTime } from '../time'
import type { Priority } from './types'

export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

export const LIMITS = {
  title: 1024,
  notes: 8192,
  tag: 40,
  tagsPerTask: 20,
  projectName: 80,
  estimateMinutes: 24 * 60,
} as const

export function normalizeTitle(title: unknown): string {
  if (typeof title !== 'string') throw new ValidationError('title', 'Title is required.')
  const t = title.trim()
  if (!t) throw new ValidationError('title', 'Title is required.')
  if (t.length > LIMITS.title) throw new ValidationError('title', `Title is longer than ${LIMITS.title} characters.`)
  return t
}

export function normalizeNotes(notes: unknown): string {
  if (notes === undefined || notes === null) return ''
  if (typeof notes !== 'string') throw new ValidationError('notes', 'Notes must be text.')
  if (notes.length > LIMITS.notes) throw new ValidationError('notes', `Notes are longer than ${LIMITS.notes} characters.`)
  return notes.replace(/\s+$/, '')
}

const TAG_RE = /^[\p{L}\p{N}_-]+$/u

/** "#Home", " home ", "HOME" all become "home"; duplicates are dropped; result is sorted. */
export function normalizeTags(tags: unknown): string[] {
  if (tags === undefined || tags === null) return []
  if (!Array.isArray(tags)) throw new ValidationError('tags', 'Tags must be a list.')
  const out = new Set<string>()
  for (const raw of tags) {
    if (typeof raw !== 'string') throw new ValidationError('tags', 'Each tag must be text.')
    const tag = raw.trim().replace(/^#+/, '').toLowerCase()
    if (!tag) continue
    if (tag.length > LIMITS.tag) throw new ValidationError('tags', `Tag "${tag}" is longer than ${LIMITS.tag} characters.`)
    if (!TAG_RE.test(tag)) throw new ValidationError('tags', `Tag "${tag}" may only contain letters, numbers, - and _.`)
    out.add(tag)
  }
  if (out.size > LIMITS.tagsPerTask) throw new ValidationError('tags', `A task can have at most ${LIMITS.tagsPerTask} tags.`)
  return [...out].sort()
}

export function normalizePriority(priority: unknown): Priority {
  if (priority === undefined || priority === null) return 4
  if (priority === 1 || priority === 2 || priority === 3 || priority === 4) return priority
  throw new ValidationError('priority', 'Priority must be 1, 2, 3 or 4.')
}

export function normalizeDue(due: unknown): Due | null {
  if (due === undefined || due === null) return null
  if (typeof due !== 'object') throw new ValidationError('due', 'Due date is malformed.')
  const { date, time } = due as { date?: unknown; time?: unknown }
  if (!isLocalDate(date)) throw new ValidationError('due', 'Due date must be a real date (YYYY-MM-DD).')
  if (time !== null && time !== undefined && !isLocalTime(time)) throw new ValidationError('due', 'Due time must be HH:mm.')
  return { date, time: (time as string | null | undefined) ?? null }
}

export function normalizeEstimate(minutes: unknown): number | null {
  if (minutes === undefined || minutes === null) return null
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > LIMITS.estimateMinutes) {
    throw new ValidationError('estimateMinutes', 'Estimate must be a whole number of minutes, at most 24 hours.')
  }
  return minutes
}

export function normalizeRecurrence(recurrence: unknown, due: Due | null): Recurrence | null {
  if (recurrence === undefined || recurrence === null) return null
  if (typeof recurrence !== 'object') throw new ValidationError('recurrence', 'Repeat setting is malformed.')
  const r = recurrence as Recurrence
  const problem = validateRecurrence(r)
  if (problem) throw new ValidationError('recurrence', problem)
  // A repeating task needs an anchor date to repeat from.
  if (!due) throw new ValidationError('recurrence', 'A repeating task needs a due date.')
  return r.kind === 'rule' ? { kind: 'rule', rrule: r.rrule.trim().replace(/^RRULE:/i, '').toUpperCase() } : { ...r }
}

export function normalizeProjectName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new ValidationError('name', 'Project name is required.')
  const n = name.trim()
  if (n.length > LIMITS.projectName) throw new ValidationError('name', `Project name is longer than ${LIMITS.projectName} characters.`)
  return n
}

const COLOR_RE = /^#[0-9a-f]{6}$/i
export const PROJECT_COLORS = ['#b84d1c', '#2f5fa7', '#2f6b3a', '#7a3e9d', '#a3262b', '#8a6d00', '#0f6e6e', '#5f5348'] as const

export function normalizeColor(color: unknown, fallbackIndex: number): string {
  if (typeof color === 'string' && COLOR_RE.test(color)) return color.toLowerCase()
  return PROJECT_COLORS[fallbackIndex % PROJECT_COLORS.length]!
}
