// Settings → Google Calendar (desktop only): import the OAuth client, connect,
// choose calendars, see sync status.

import { useId, useState, type ChangeEvent } from 'react'
import type { GoogleStatus } from '../shared/google'
import { toAppError } from '../storage/api'
import { useApi, useLive } from './data'

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const mins = Math.round((now - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleString()
}

export function GoogleSettings() {
  const api = useApi()
  const id = useId()
  const { data: status } = useLive((a) => a.google.status(), [], ['calendar'])
  const [busy, setBusy] = useState<null | 'import' | 'connect' | 'disconnect' | 'sync'>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  if (!status) return null
  if (!status.available) {
    return (
      <section className="settings-section" aria-labelledby={`${id}-h`}>
        <h3 id={`${id}-h`}>Google Calendar</h3>
        <p className="hint">Google Calendar and Google Tasks work in the desktop app. This demo shows a generated sample calendar instead.</p>
      </section>
    )
  }

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<GoogleStatus>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(toAppError(e).message)
    } finally {
      setBusy(null)
    }
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again after an error
    if (!file) return
    if (file.size > 64 * 1024) {
      setError('That file is too large to be an OAuth client file.')
      return
    }
    await run('import', async () => api.google.importClient(await file.text()))
  }

  return (
    <section className="settings-section google-settings" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Google Calendar</h3>

      <ol className="steps-list">
        <li>
          <strong>OAuth client.</strong>{' '}
          {status.clientConfigured ? (
            <span>Imported and stored encrypted. </span>
          ) : (
            <span>Miss Minutes connects with your own Google Cloud “Desktop app” client (setup steps are in the README). </span>
          )}
          <label className="file-button">
            <input type="file" accept="application/json,.json" onChange={onFile} disabled={busy !== null} className="visually-hidden" />
            <span aria-hidden="true">{status.clientConfigured ? 'Replace client file…' : 'Import client file…'}</span>
            <span className="visually-hidden">{status.clientConfigured ? 'Replace the OAuth client file' : 'Import the OAuth client file'}</span>
          </label>
        </li>

        <li>
          <strong>Connection.</strong>{' '}
          {status.connected ? (
            <>
              <span className="ok-text">Connected</span> (read-only access to your calendars).{' '}
              {confirmDisconnect ? (
                <span className="inline-actions">
                  <span>Disconnect and delete the calendar data Miss Minutes has stored?</span>
                  <button type="button" className="danger" disabled={busy !== null} onClick={() => run('disconnect', () => api.google.disconnect()).then(() => setConfirmDisconnect(false))}>
                    Disconnect
                  </button>
                  <button type="button" onClick={() => setConfirmDisconnect(false)}>Cancel</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDisconnect(true)}>Disconnect…</button>
              )}
            </>
          ) : (
            <>
              {status.needsReconnect && <span className="error-text">Google access expired or was revoked. </span>}
              <button type="button" className="primary" disabled={!status.clientConfigured || busy !== null} onClick={() => run('connect', () => api.google.connect())}>
                {status.needsReconnect ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
              </button>
              {busy === 'connect' && <span role="status"> Finish signing in in your browser…</span>}
            </>
          )}
        </li>

        {status.connected && (
          <li>
            <strong>Calendars to show.</strong>
            <ul className="calendar-choices">
              {status.calendars.map((c) => (
                <li key={c.id}>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      disabled={!c.readable || busy !== null}
                      onChange={(e) => run('sync', () => api.google.setCalendar(c.id, e.target.checked))}
                    />
                    <span className="dot" style={{ background: c.color ?? 'var(--p3)' }} aria-hidden="true" />
                    {c.summary}
                    {c.primary && <span className="muted"> (primary)</span>}
                    {!c.readable && <span className="muted"> (free/busy only: no details to show)</span>}
                  </label>
                </li>
              ))}
            </ul>
            <p className="hint">
              <span role="status">{status.syncing || busy === 'sync' ? 'Syncing…' : `Last synced ${ago(status.lastSync)}.`}</span>{' '}
              <button type="button" className="link-button" disabled={busy !== null || status.syncing} onClick={() => run('sync', () => api.google.syncNow())}>
                Sync now
              </button>
            </p>
          </li>
        )}
      </ol>

      {(error ?? status.lastError) && (
        <p className="error-text" role="alert">
          {error ?? status.lastError}
        </p>
      )}
    </section>
  )
}
