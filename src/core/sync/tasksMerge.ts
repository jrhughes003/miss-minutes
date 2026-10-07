// ===========================================================================
// Google Tasks two-way sync: the decision logic (D13, D31)
// ===========================================================================
//
// This file decides *what* to do for each task. It does no I/O, so every
// rule can be tested exhaustively (see tasksMerge.test.ts and the property
// test). The orchestrator (electron/google/tasksSync.ts) carries the
// decisions out.
//
// The core idea is a three-way merge. For every task synced before, we keep
// a *snapshot*: the shared fields as they were when both sides last agreed.
// At the next sync there are three versions of each field:
//
//     base   = the snapshot (last agreed value)
//     local  = the value in Miss Minutes now
//     remote = the value in Google Tasks now
//
// and the snapshot tells us who changed what:
//
//     local == remote             → nothing to do (or both made the same change)
//     local == base, remote ≠ base → only Google changed it → take remote
//     remote == base, local ≠ base → only we changed it     → take local
//     all three differ             → both changed it        → CONFLICT: local wins,
//                                                              remote value logged (D31)
//
// Doing this per *field* rather than per task means edits on both sides
// survive when they touch different fields: rename on the phone, reschedule
// on the PC, and both changes stay. "Last writer wins" on the whole task
// would silently drop one of them.
//
// Deletions (D31):
//   deleted on one side, unchanged on the other → delete on both
//   deleted on one side, EDITED on the other    → keep the edit, re-create on
//                                                 the deleting side, and log it
// Losing an edit is worse than a task reappearing.
// ===========================================================================

/** The fields both systems can hold. Priority, tags, time of day, reminders and repeats stay local-only (D13). */
export interface SyncFields {
  title: string
  notes: string
  /** Due date only: Google Tasks discards the time of day. */
  due: string | null
  done: boolean
}

export const SYNC_FIELDS = ['title', 'notes', 'due', 'done'] as const
export type SyncField = (typeof SYNC_FIELDS)[number]

export interface Conflict {
  field: SyncField
  kept: SyncFields[SyncField]
  overwritten: SyncFields[SyncField]
}

export interface MergeResult {
  merged: SyncFields
  /** Fields where both sides changed differently: local won, and the remote value is recorded here. */
  conflicts: Conflict[]
  /** Fields the local task must change to reach `merged`. */
  localChanges: Partial<SyncFields>
  /** Fields Google must change to reach `merged`. */
  remoteChanges: Partial<SyncFields>
}

export function sameFields(a: SyncFields, b: SyncFields): boolean {
  return SYNC_FIELDS.every((f) => a[f] === b[f])
}

/** The three-way, field-by-field merge described at the top of the file. */
export function mergeFields(base: SyncFields, local: SyncFields, remote: SyncFields): MergeResult {
  const merged = { ...local }
  const conflicts: Conflict[] = []
  for (const f of SYNC_FIELDS) {
    const b = base[f]
    const l = local[f]
    const r = remote[f]
    if (l === r) continue // same either way
    if (l === b) (merged as Record<SyncField, unknown>)[f] = r // only Google changed it
    else if (r !== b) conflicts.push({ field: f, kept: l, overwritten: r }) // both changed: local wins
    // else only we changed it: merged already holds local
  }
  const localChanges: Partial<SyncFields> = {}
  const remoteChanges: Partial<SyncFields> = {}
  for (const f of SYNC_FIELDS) {
    if (merged[f] !== local[f]) (localChanges as Record<SyncField, unknown>)[f] = merged[f]
    if (merged[f] !== remote[f]) (remoteChanges as Record<SyncField, unknown>)[f] = merged[f]
  }
  return { merged, conflicts, localChanges, remoteChanges }
}

// ---------------------------------------------------------------------------
// One task's decision
// ---------------------------------------------------------------------------

export type RemoteState =
  /** Google didn't report this task as changed since the last sync: it still equals the snapshot. */
  | { kind: 'unchanged' }
  | { kind: 'present'; fields: SyncFields }
  | { kind: 'deleted' }

export type Decision =
  | { kind: 'none' }
  | { kind: 'update'; merge: MergeResult }
  | { kind: 'deleteLocal' }
  | { kind: 'deleteRemote' }
  /** Deleted locally but edited in Google: bring it back locally. */
  | { kind: 'recreateLocal'; fields: SyncFields }
  /** Deleted in Google but edited locally: create it again in Google. */
  | { kind: 'recreateRemote' }
  /** Gone on both sides: just forget the mapping. */
  | { kind: 'forget' }

/**
 * The decision for one task that has been synced before (it has a snapshot).
 * `local` is null if the task no longer exists in Miss Minutes.
 */
export function decide(snapshot: SyncFields, local: SyncFields | null, remote: RemoteState): Decision {
  const remoteFields = remote.kind === 'present' ? remote.fields : remote.kind === 'unchanged' ? snapshot : null

  if (local === null) {
    if (remoteFields === null) return { kind: 'forget' }
    // Deleted here. If Google's copy was edited since we last agreed, keep that edit.
    return sameFields(remoteFields, snapshot) ? { kind: 'deleteRemote' } : { kind: 'recreateLocal', fields: remoteFields }
  }
  if (remoteFields === null) {
    // Deleted in Google. If ours was edited since we last agreed, keep that edit.
    return sameFields(local, snapshot) ? { kind: 'deleteLocal' } : { kind: 'recreateRemote' }
  }
  const merge = mergeFields(snapshot, local, remoteFields)
  const noChange = Object.keys(merge.localChanges).length === 0 && Object.keys(merge.remoteChanges).length === 0
  return noChange && merge.conflicts.length === 0 ? { kind: 'none' } : { kind: 'update', merge }
}

// ---------------------------------------------------------------------------
// Which unmapped tasks to introduce to the other side
// ---------------------------------------------------------------------------

/**
 * Unsynced tasks cross over only while open. Turning sync on must not push
 * years of completed history into Google Tasks, or pull Google's completed
 * history in here (D36). Completed tasks that were already synced keep
 * syncing like any other.
 */
export function shouldIntroduce(fields: SyncFields): boolean {
  return !fields.done
}
