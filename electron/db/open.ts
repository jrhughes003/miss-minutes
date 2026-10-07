// Opens the app's database file, backing it up before any schema upgrade.

import fs from 'node:fs'
import path from 'node:path'
import { openDatabase, type SqlDatabase } from './database'
import { backupTo, migrate } from './migrations'

export const DB_FILE_NAME = 'missminutes.db'

export function openAppDatabase(userDataDir: string): SqlDatabase {
  fs.mkdirSync(userDataDir, { recursive: true })
  const file = path.join(userDataDir, DB_FILE_NAME)
  const db = openDatabase(file)
  migrate(db, {
    backup: (fromVersion) => {
      const target = path.join(userDataDir, `${DB_FILE_NAME}.pre-v${fromVersion + 1}.bak`)
      if (fs.existsSync(target)) fs.rmSync(target) // VACUUM INTO refuses to overwrite
      backupTo(db, target)
    },
  })
  return db
}
