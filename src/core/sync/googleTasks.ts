// Google Tasks API shapes, and mapping them to and from the shared sync fields.
// Reference: https://developers.google.com/workspace/tasks/reference/rest/v1/tasks
//
// Facts this relies on (checked 2026-10-06):
// - `due` is date-only: Google keeps "YYYY-MM-DDT00:00:00.000Z" and discards
//   any time. The local due *time* therefore never syncs (D13).
// - `status` is "needsAction" or "completed".
// - Deleted tasks are reported with `deleted: true` when `showDeleted=true`;
//   completed tasks cleared from view have `hidden: true`. Hidden is not
//   deletion: they stay completed (D31).
// - There is no sync token. Changes are found with `updatedMin`.

import type { SyncFields } from './tasksMerge'

export interface GoogleTaskList {
  id: string
  title: string
  updated?: string
}

export interface GoogleTask {
  id: string
  title?: string
  notes?: string
  status?: 'needsAction' | 'completed'
  due?: string
  completed?: string
  deleted?: boolean
  hidden?: boolean
  parent?: string
  position?: string
  updated?: string
  etag?: string
}

export function fromGoogleTask(t: GoogleTask): SyncFields {
  return {
    title: (t.title ?? '').trim() || '(untitled)',
    // Trimmed the way local notes are, so a trailing newline from Google can't
    // look like a change on every sync.
    notes: (t.notes ?? '').replace(/\s+$/, ''),
    due: t.due ? t.due.slice(0, 10) : null,
    done: t.status === 'completed',
  }
}

/** A create or update request body. `due: null` clears the date. */
export type GoogleTaskWrite = Omit<Partial<GoogleTask>, 'due'> & { due?: string | null }

/** The request body for creating or updating a task in Google. */
export function toGoogleTask(f: Partial<SyncFields>): GoogleTaskWrite {
  const out: GoogleTaskWrite = {}
  if (f.title !== undefined) out.title = f.title
  if (f.notes !== undefined) out.notes = f.notes
  if (f.due !== undefined) out.due = f.due === null ? null : `${f.due}T00:00:00.000Z`
  if (f.done !== undefined) out.status = f.done ? 'completed' : 'needsAction'
  return out
}
