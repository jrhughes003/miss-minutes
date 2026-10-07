// Persistence for Google Tasks sync (tables created by migration 5).

import type { SyncFields } from '../../src/core/sync/tasksMerge'
import type { SqlDatabase } from '../db/database'

export interface TaskMapping {
  localId: string
  googleId: string
  listId: string
  snapshot: SyncFields
}

export interface OutboxRow {
  localId: string
  listId: string
  title: string
  parentGoogleId: string | null
  createdAt: string
}

export interface SyncLogEntry {
  at: string
  kind: 'conflict' | 'deleted-local' | 'deleted-remote' | 'restored-local' | 'restored-remote' | 'adopted' | 'list' | 'skipped' | 'error'
  title: string
  detail: string
}

export const INBOX_KEY = 'inbox'

export class TasksSyncStore {
  private readonly q

  constructor(private readonly db: SqlDatabase) {
    this.q = {
      lists: db.prepare('SELECT * FROM gtasks_lists'),
      setList: db.prepare('INSERT INTO gtasks_lists (project_key, list_id) VALUES (@k, @l) ON CONFLICT (project_key) DO UPDATE SET list_id = excluded.list_id, hwm = NULL'),
      setHwm: db.prepare('UPDATE gtasks_lists SET hwm = @h WHERE list_id = @l'),
      dropList: db.prepare('DELETE FROM gtasks_lists WHERE project_key = @k'),
      maps: db.prepare('SELECT * FROM gtasks_map'),
      map: db.prepare('INSERT OR REPLACE INTO gtasks_map (local_id, google_id, list_id, snapshot) VALUES (@local, @google, @list, @snap)'),
      unmap: db.prepare('DELETE FROM gtasks_map WHERE local_id = @local'),
      outbox: db.prepare('SELECT * FROM gtasks_outbox'),
      addOutbox: db.prepare('INSERT OR REPLACE INTO gtasks_outbox (local_id, list_id, title, parent_google_id, created_at) VALUES (@local, @list, @title, @parent, @at)'),
      dropOutbox: db.prepare('DELETE FROM gtasks_outbox WHERE local_id = @local'),
      log: db.prepare('INSERT INTO gtasks_log (at, kind, title, detail) VALUES (@at, @kind, @title, @detail)'),
      recent: db.prepare('SELECT * FROM gtasks_log ORDER BY id DESC LIMIT @n'),
    }
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  lists(): { projectKey: string; listId: string; hwm: string | null }[] {
    return this.q.lists.all().map((r) => ({ projectKey: String(r.project_key), listId: String(r.list_id), hwm: r.hwm === null ? null : String(r.hwm) }))
  }

  setList(projectKey: string, listId: string): void {
    this.q.setList.run({ k: projectKey, l: listId })
  }

  setHwm(listId: string, hwm: string): void {
    this.q.setHwm.run({ h: hwm, l: listId })
  }

  dropList(projectKey: string): void {
    this.q.dropList.run({ k: projectKey })
  }

  mappings(): TaskMapping[] {
    return this.q.maps.all().map((r) => ({ localId: String(r.local_id), googleId: String(r.google_id), listId: String(r.list_id), snapshot: JSON.parse(String(r.snapshot)) as SyncFields }))
  }

  map(m: TaskMapping): void {
    this.q.map.run({ local: m.localId, google: m.googleId, list: m.listId, snap: JSON.stringify(m.snapshot) })
  }

  unmap(localId: string): void {
    this.q.unmap.run({ local: localId })
  }

  outbox(): OutboxRow[] {
    return this.q.outbox.all().map((r) => ({ localId: String(r.local_id), listId: String(r.list_id), title: String(r.title), parentGoogleId: r.parent_google_id === null ? null : String(r.parent_google_id), createdAt: String(r.created_at) }))
  }

  addOutbox(o: OutboxRow): void {
    this.q.addOutbox.run({ local: o.localId, list: o.listId, title: o.title, parent: o.parentGoogleId, at: o.createdAt })
  }

  dropOutbox(localId: string): void {
    this.q.dropOutbox.run({ local: localId })
  }

  log(e: SyncLogEntry): void {
    this.q.log.run({ at: e.at, kind: e.kind, title: e.title, detail: e.detail })
  }

  recentLog(n = 20): SyncLogEntry[] {
    return this.q.recent.all({ n }).map((r) => ({ at: String(r.at), kind: String(r.kind) as SyncLogEntry['kind'], title: String(r.title), detail: String(r.detail) }))
  }

  /** Forgets all sync state (when sync is turned off or Google is disconnected). Local tasks are kept. */
  reset(): void {
    this.db.exec('DELETE FROM gtasks_lists; DELETE FROM gtasks_map; DELETE FROM gtasks_outbox;')
  }
}
