// Google Tasks two-way sync: carrying out the decisions from
// src/core/sync/tasksMerge.ts (D13, D31).
//
// One sync, in order:
//  1. Lists. The Inbox maps to the default list, each project to a list of its
//     own. Lists that exist on only one side are matched by name or created.
//  2. Changes. Each list is asked for tasks updated since its high-water mark,
//     including deleted and hidden ones.
//  3. Outbox. Inserts left unresolved by a crash or an ambiguous error are
//     matched to the Google task they created, instead of being inserted again.
//  4. Synced tasks. A three-way merge per task, then deletes and re-creations
//     per D31, and moves when a task changed project here.
//  5. New Google tasks come in (open ones only).
//  6. New local tasks go out (open ones only), parents before subtasks.
//
// Every local change goes through TaskService, so the usual rules still
// apply: completing a repeating task here creates its next occurrence,
// which step 6 then sends to Google.

import type { Clock } from '../../src/core/clock'
import { fromGoogleTask, toGoogleTask, type GoogleTask } from '../../src/core/sync/googleTasks'
import { decide, shouldIntroduce, type SyncFields } from '../../src/core/sync/tasksMerge'
import type { TaskService } from '../../src/core/tasks/service'
import type { Task } from '../../src/core/tasks/types'
import { GoogleApiError, type GoogleApi } from './api'
import { INBOX_KEY, type TasksSyncStore } from './tasksSyncStore'

export interface TasksSyncResult {
  pulled: number
  pushed: number
  updated: number
  deleted: number
  conflicts: number
}

export function fromLocal(t: Task): SyncFields {
  return { title: t.title, notes: t.notes, due: t.due?.date ?? null, done: t.status === 'done' }
}

/** A project whose Google list was deleted: its sync is off until the owner turns it back on. */
const DETACHED = 'detached:'
const isDetached = (listId: string) => listId.startsWith(DETACHED)

/** How far back to re-read before the high-water mark, in case two changes share a timestamp. */
const OVERLAP_MS = 1000

export async function syncTasks(api: GoogleApi, store: TasksSyncStore, tasks: TaskService, clock: Clock): Promise<TasksSyncResult> {
  const result: TasksSyncResult = { pulled: 0, pushed: 0, updated: 0, deleted: 0, conflicts: 0 }
  const now = () => clock.now().toISOString()
  const log = (kind: Parameters<TasksSyncStore['log']>[0]['kind'], title: string, detail: string) => store.log({ at: now(), kind, title, detail })

  // ---- 1. Lists -------------------------------------------------------------
  const remoteLists = await api.listTaskLists()
  const defaultList = await api.defaultTaskList()
  const remoteListIds = new Set(remoteLists.map((l) => l.id))
  const projects = tasks.listProjects()
  const keyOf = (projectId: string | null) => projectId ?? INBOX_KEY

  let mapped = store.lists()
  if (!mapped.some((m) => m.projectKey === INBOX_KEY)) store.setList(INBOX_KEY, defaultList.id)
  for (const m of store.lists()) {
    if (isDetached(m.listId)) continue
    const projectGone = m.projectKey !== INBOX_KEY && !projects.some((p) => p.id === m.projectKey)
    if (!remoteListIds.has(m.listId) || projectGone) {
      // The list (or the project) was deleted on one side. Tasks are kept
      // where they are, and sync for that project stops rather than guessing:
      // the project is marked detached, so its list isn't silently re-created.
      store.tx(() => {
        for (const t of store.mappings()) if (t.listId === m.listId) store.unmap(t.localId)
        if (projectGone) store.dropList(m.projectKey)
        else store.setList(m.projectKey, `${DETACHED}${m.projectKey}`)
      })
      log('list', projects.find((p) => p.id === m.projectKey)?.name ?? m.projectKey, projectGone ? 'Project deleted here; its Google list is no longer synced.' : 'Google list was deleted; this project’s tasks were kept here, and sync for it is off.')
    }
  }
  mapped = store.lists()
  for (const l of remoteLists) {
    if (l.id === defaultList.id || mapped.some((m) => m.listId === l.id)) continue
    const sameName = projects.find((p) => p.name.toLowerCase() === l.title.trim().toLowerCase() && !mapped.some((m) => m.projectKey === p.id))
    const project = sameName ?? tasks.createProject(uniqueName(l.title, projects.map((p) => p.name)))
    if (!sameName) projects.push(project)
    store.setList(project.id, l.id)
    mapped = store.lists()
  }
  const listFor = (projectId: string | null) => store.lists().find((m) => m.projectKey === keyOf(projectId))?.listId ?? null
  const syncsProject = (projectId: string | null) => !isDetached(listFor(projectId) ?? '')
  const projectForList = (listId: string) => {
    const key = store.lists().find((m) => m.listId === listId)?.projectKey
    return key === undefined ? undefined : key === INBOX_KEY ? null : key
  }
  async function ensureList(projectId: string | null): Promise<string> {
    const existing = listFor(projectId)
    if (existing) return existing
    const name = projects.find((p) => p.id === projectId)?.name ?? 'Miss Minutes'
    const created = await api.insertTaskList(name)
    store.setList(keyOf(projectId), created.id)
    return created.id
  }

  // ---- 2. Changes ------------------------------------------------------------
  const remote = new Map<string, { task: GoogleTask; listId: string }>()
  for (const m of store.lists()) {
    if (isDetached(m.listId)) continue
    const since = m.hwm ? new Date(Date.parse(m.hwm) - OVERLAP_MS).toISOString() : undefined
    const changed = await api.listTasks(m.listId, since)
    let hwm = m.hwm ?? ''
    for (const t of changed) {
      remote.set(t.id, { task: t, listId: m.listId })
      if ((t.updated ?? '') > hwm) hwm = t.updated!
    }
    if (hwm) store.setHwm(m.listId, hwm)
  }

  // ---- 3. Outbox -------------------------------------------------------------
  const mappedGoogle = () => new Set(store.mappings().map((m) => m.googleId))
  for (const o of store.outbox()) {
    const taken = mappedGoogle()
    // Match on content only, not on time: Google's timestamps and this PC's
    // clock can disagree. If several tasks match, take the newest. Adopting a
    // same-titled task the user also made on the phone merges the two, which
    // is safer than creating a duplicate.
    const match = [...remote.values()]
      .filter(({ task, listId }) => listId === o.listId && !task.deleted && !taken.has(task.id) && (task.title ?? '') === o.title && (task.parent ?? null) === o.parentGoogleId)
      .sort((a, b) => (b.task.updated ?? '').localeCompare(a.task.updated ?? ''))[0]
    const local = tasks.getTask(o.localId)
    store.tx(() => {
      if (match && local) {
        store.map({ localId: o.localId, googleId: match.task.id, listId: o.listId, snapshot: fromGoogleTask(match.task) })
        log('adopted', o.title, 'An earlier upload had an unclear result; matched it to the task Google created instead of uploading again.')
      }
      store.dropOutbox(o.localId) // no match: the task counts as unsynced and is uploaded again below
    })
  }

  // ---- 4. Synced tasks ------------------------------------------------------
  for (const m of store.mappings()) {
    const localTask = tasks.getTask(m.localId)
    const r = remote.get(m.googleId)
    const remoteState = !r ? ({ kind: 'unchanged' } as const) : r.task.deleted ? ({ kind: 'deleted' } as const) : ({ kind: 'present', fields: fromGoogleTask(r.task) } as const)
    const d = decide(m.snapshot, localTask ? fromLocal(localTask) : null, remoteState)
    const title = localTask?.title ?? m.snapshot.title

    switch (d.kind) {
      case 'none':
        break
      case 'forget':
        store.unmap(m.localId)
        break
      case 'deleteLocal':
        tasks.deleteTask(m.localId)
        store.unmap(m.localId)
        log('deleted-local', title, 'Deleted in Google Tasks, so deleted here too.')
        result.deleted++
        break
      case 'deleteRemote':
        await api.deleteTask(m.listId, m.googleId).catch((e: unknown) => {
          if (!(e instanceof GoogleApiError && e.status === 404)) throw e
        })
        store.unmap(m.localId)
        log('deleted-remote', title, 'Deleted here, so deleted in Google Tasks too.')
        result.deleted++
        break
      case 'recreateLocal': {
        const parentLocal = r?.task.parent ? store.mappings().find((x) => x.googleId === r.task.parent)?.localId : undefined
        const created = tasks.createTask({
          title: d.fields.title,
          notes: d.fields.notes,
          due: d.fields.due ? { date: d.fields.due, time: null } : null,
          projectId: projectForList(m.listId) ?? null,
          ...(parentLocal && tasks.getTask(parentLocal)?.parentId === null ? { parentId: parentLocal } : {}),
        })
        if (d.fields.done) tasks.completeTask(created.id)
        store.tx(() => {
          store.unmap(m.localId)
          store.map({ localId: created.id, googleId: m.googleId, listId: m.listId, snapshot: d.fields })
        })
        log('restored-local', d.fields.title, 'Deleted here but edited in Google Tasks, so it was brought back (D31).')
        result.pulled++
        break
      }
      case 'recreateRemote':
        store.unmap(m.localId) // step 6 uploads it again as a new Google task
        log('restored-remote', title, 'Deleted in Google Tasks but edited here, so it was created there again (D31).')
        break
      case 'update': {
        let { merged } = d.merge
        const remoteChanges = { ...d.merge.remoteChanges }
        const lc = d.merge.localChanges
        if (localTask && (lc.title !== undefined || lc.notes !== undefined || lc.due !== undefined)) {
          try {
            tasks.updateTask(localTask.id, {
              ...(lc.title !== undefined ? { title: lc.title } : {}),
              ...(lc.notes !== undefined ? { notes: lc.notes } : {}),
              // Google holds only the date; keep our time of day when the date moves.
              ...(lc.due !== undefined ? { due: lc.due === null ? null : { date: lc.due, time: localTask.due?.time ?? null } } : {}),
            })
          } catch (e) {
            // e.g. Google cleared the date of a repeating task, which needs one: keep ours and send it back.
            const keep = fromLocal(localTask)
            merged = { ...merged, title: keep.title, notes: keep.notes, due: keep.due }
            Object.assign(remoteChanges, { title: keep.title, notes: keep.notes, due: keep.due })
            log('skipped', localTask.title, `Kept the local version: ${(e as Error).message}`)
          }
        }
        if (localTask && lc.done !== undefined) {
          if (lc.done) tasks.completeTask(localTask.id)
          else tasks.reopenTask(localTask.id)
        }
        if (Object.keys(remoteChanges).length) await api.patchTask(m.listId, m.googleId, toGoogleTask(remoteChanges))
        for (const c of d.merge.conflicts) {
          log('conflict', title, `Both sides changed ${c.field}. Kept "${String(c.kept)}"; Google had "${String(c.overwritten)}".`)
          result.conflicts++
        }
        store.map({ ...m, snapshot: merged })
        result.updated++
        break
      }
    }

    // A task that changed project here moves to that project's list.
    const after = tasks.getTask(m.localId)
    const stillMapped = store.mappings().find((x) => x.localId === m.localId)
    if (after && stillMapped && after.parentId === null && syncsProject(after.projectId)) {
      const target = await ensureList(after.projectId)
      if (target !== stillMapped.listId) {
        await api.moveTask(stillMapped.listId, stillMapped.googleId, target)
        store.map({ ...stillMapped, listId: target })
      }
    }
  }

  // ---- 5. New Google tasks come in ---------------------------------------------
  const known = mappedGoogle()
  const incoming = [...remote.values()].filter(({ task }) => !known.has(task.id) && !task.deleted && shouldIntroduce(fromGoogleTask(task)))
  incoming.sort((a, b) => Number(Boolean(a.task.parent)) - Number(Boolean(b.task.parent))) // parents first
  for (const { task, listId } of incoming) {
    const projectId = projectForList(listId)
    if (projectId === undefined) continue
    const f = fromGoogleTask(task)
    const parentLocal = task.parent ? store.mappings().find((x) => x.googleId === task.parent)?.localId : undefined
    const parentOk = parentLocal !== undefined && tasks.getTask(parentLocal)?.parentId === null
    const created = tasks.createTask({ title: f.title, notes: f.notes, due: f.due ? { date: f.due, time: null } : null, projectId, ...(parentOk ? { parentId: parentLocal } : {}) })
    store.map({ localId: created.id, googleId: task.id, listId, snapshot: f })
    result.pulled++
  }

  // ---- 6. New local tasks go out ------------------------------------------------
  const mappedLocal = new Set(store.mappings().map((m) => m.localId))
  const outgoing = tasks
    .listTasks({ status: 'open', includeSubtasks: true })
    .filter((t) => !mappedLocal.has(t.id) && shouldIntroduce(fromLocal(t)) && syncsProject(t.projectId))
    .sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null)) // parents first
  for (const t of outgoing) {
    const listId = await ensureList(t.projectId)
    const parentGoogleId = t.parentId ? (store.mappings().find((x) => x.localId === t.parentId)?.googleId ?? null) : null
    store.addOutbox({ localId: t.id, listId, title: t.title, parentGoogleId, createdAt: now() })
    try {
      const created = await api.insertTask(listId, toGoogleTask(fromLocal(t)), parentGoogleId ?? undefined)
      store.tx(() => {
        store.map({ localId: t.id, googleId: created.id, listId, snapshot: fromGoogleTask(created) })
        store.dropOutbox(t.id)
      })
      result.pushed++
    } catch (e) {
      // A definite refusal (4xx) can be forgotten: it will simply be retried
      // next time. Anything else is ambiguous: the outbox row stays, and step
      // 3 settles it.
      if (e instanceof GoogleApiError && e.status >= 400 && e.status < 500) {
        store.dropOutbox(t.id)
        log('error', t.title, `Google refused the upload: ${e.message}`)
      } else {
        log('error', t.title, 'The upload result was unclear; it will be checked on the next sync.')
      }
    }
  }
  return result
}

function uniqueName(name: string, taken: string[]): string {
  const base = name.trim() || 'Google list'
  const lower = new Set(taken.map((t) => t.toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!lower.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`
}
