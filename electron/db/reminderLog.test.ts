import { sampleTask } from '../../src/test/repoContract'
import { reminderLogContract } from '../../src/test/reminderLogContract'
import { openDatabase } from './database'
import { migrate } from './migrations'
import { SqliteReminderLog } from './reminderLog'
import { SqliteTaskRepo } from './taskRepo'

reminderLogContract('SQLite', () => {
  const db = openDatabase(':memory:')
  migrate(db)
  // The log references its task, as in the real app.
  new SqliteTaskRepo(db).putTask(sampleTask({ id: 't1' }))
  return new SqliteReminderLog(db)
})
