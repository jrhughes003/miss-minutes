// Human-friendly labels for dates, relative to "today" in the user's zone.

import type { Due } from '../core/recurrence'
import { addDays, daysBetween, type LocalDate } from '../core/time'

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' })
const short = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const withYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// LocalDates are formatted as UTC midnight, so the viewer's own zone can never shift the day.
const asUtc = (d: LocalDate) => new Date(`${d}T00:00:00Z`)

export function formatDate(date: LocalDate, today: LocalDate): string {
  const diff = daysBetween(today, date)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return weekday.format(asUtc(date))
  return date.slice(0, 4) === today.slice(0, 4) ? short.format(asUtc(date)) : withYear.format(asUtc(date))
}

/** "08:00" → "8:00 a.m." in the viewer's locale. */
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)))
}

export function formatDue(due: Due, today: LocalDate): string {
  const day = formatDate(due.date, today)
  return due.time ? `${day} ${formatTime(due.time)}` : day
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later'

export function dueState(due: Due, today: LocalDate): DueState {
  if (due.date < today) return 'overdue'
  if (due.date === today) return 'today'
  if (due.date <= addDays(today, 6)) return 'soon'
  return 'later'
}

export const PRIORITY_LABELS: Record<1 | 2 | 3 | 4, string> = { 1: 'P1 urgent', 2: 'P2 high', 3: 'P3 medium', 4: 'P4 none' }
