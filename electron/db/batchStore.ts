import type { BatchStore, PlanBatch } from '../../src/core/plan/apply'
import type { SqlDatabase } from './database'

export function sqliteBatchStore(db: SqlDatabase): BatchStore {
  const save = db.prepare('INSERT INTO plan_batches (id, at, data) VALUES (@id, @at, @data) ON CONFLICT (id) DO UPDATE SET data = excluded.data')
  const get = db.prepare('SELECT data FROM plan_batches WHERE id = @id')
  const latest = db.prepare('SELECT data FROM plan_batches ORDER BY at DESC, rowid DESC LIMIT 1')
  return {
    save: (b) => void save.run({ id: b.id, at: b.at, data: JSON.stringify(b) }),
    get: (id) => {
      const r = get.get({ id })
      return r ? (JSON.parse(String(r.data)) as PlanBatch) : null
    },
    latest: () => {
      const r = latest.get()
      return r ? (JSON.parse(String(r.data)) as PlanBatch) : null
    },
  }
}
