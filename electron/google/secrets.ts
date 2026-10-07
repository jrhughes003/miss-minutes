// Secrets at rest: the Google OAuth client and tokens, and (from M6) the
// Anthropic API key.
//
// Values are encrypted with Electron's safeStorage before they reach the
// database. On Windows that's DPAPI: the key belongs to the signed-in Windows
// user, so a copied database file is unreadable on another account or
// machine. If encryption isn't available, nothing is stored. A secret is
// never written in plain text as a fallback.
//
// The cipher is injected so tests can run without Electron.

import type { SqlDatabase } from '../db/database'

export interface Cipher {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export interface SecretStore {
  get(name: string): string | null
  set(name: string, value: string): void
  delete(name: string): void
}

/** Secrets in the settings table under a `secret:` prefix, encrypted with `cipher`. */
export function sqliteSecretStore(db: SqlDatabase, cipher: Cipher): SecretStore {
  const get = db.prepare('SELECT value FROM settings WHERE key = @key')
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
  const del = db.prepare('DELETE FROM settings WHERE key = @key')
  const key = (name: string) => `secret:${name}`
  return {
    get(name) {
      const row = get.get({ key: key(name) })
      if (!row) return null
      if (!cipher.available()) throw new Error('Secure storage is not available on this system.')
      return cipher.decrypt(Buffer.from(String(row.value), 'base64'))
    },
    set(name, value) {
      if (!cipher.available()) throw new Error('Secure storage is not available on this system, so Miss Minutes will not store this secret.')
      set.run({ key: key(name), value: cipher.encrypt(value).toString('base64') })
    },
    delete(name) {
      del.run({ key: key(name) })
    },
  }
}
