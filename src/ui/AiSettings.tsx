// Settings → AI: the API key, the on/off switch, what's sent, usage this
// month, and spending limits (D19).

import { useId, useState, type FormEvent } from 'react'
import type { AiStatus } from '../shared/ai'
import { toAppError } from '../storage/api'
import { useApi, useLive } from './data'
import { OptimisticToggle } from './OptimisticToggle'

const usd = (n: number) => (n < 0.01 && n > 0 ? '< $0.01' : `$${n.toFixed(2)}`)

export function AiSettings() {
  const api = useApi()
  const id = useId()
  const { data: status } = useLive((a) => a.ai.status(), [], ['ai', 'settings'])
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState('')

  if (!status) return null

  const run = async (fn: () => Promise<AiStatus>, done = 'Saved') => {
    setError(null)
    try {
      await fn()
      setSaved(done)
    } catch (e) {
      setError(toAppError(e).message)
    }
  }

  if (!status.available) {
    return (
      <section className="settings-section" aria-labelledby={`${id}-h`}>
        <h3 id={`${id}-h`}>AI</h3>
        <p className="hint">Typed sentences are understood on this device. Claude-powered features are available in the desktop app with your own API key.</p>
      </section>
    )
  }

  const saveKey = (e: FormEvent) => {
    e.preventDefault()
    void run(() => api.ai.setKey(key), 'Key saved').then(() => setKey(''))
  }

  return (
    <section className="settings-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>AI</h3>
      {status.simulated && <p className="hint"><strong>Simulated:</strong> no real model is called here; responses come from the on-device parser and usage figures are estimates.</p>}
      {status.mock && !status.simulated && <p className="hint"><strong>Development mode:</strong> AI requests go to a local mock server, not to Anthropic.</p>}

      {!status.simulated && (
        <>
          <p>
            {status.keySet ? 'Your Anthropic API key is saved (encrypted on this computer).' : 'Add your own Anthropic API key to let Claude understand what you type.'}{' '}
            {status.keySet && (
              <button type="button" className="link-button" onClick={() => void run(() => api.ai.clearKey(), 'Key removed')}>
                Remove key
              </button>
            )}
          </p>
          <form onSubmit={saveKey} className="inline-form settings-row">
            <label htmlFor={`${id}-key`}>{status.keySet ? 'Replace key' : 'API key'}</label>
            <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
            <button type="submit" disabled={!key.trim()}>Save key</button>
          </form>
        </>
      )}

      <OptimisticToggle checked={status.enabled} disabled={!status.keySet} onChange={(enabled) => api.ai.setPrefs({ enabled })} onError={(e) => setError(toAppError(e).message)}>
        Use Claude to understand what I type (otherwise it’s understood on this device)
      </OptimisticToggle>
      <p className="hint">
        Sent for each sentence: the sentence itself, today’s date and time zone, and your project and tag names. Nothing else: no other tasks, no calendar.
      </p>

      <h4>This month</h4>
      <table className="usage-table">
        <thead>
          <tr><th scope="col">Feature</th><th scope="col">Calls</th><th scope="col">Tokens in / out</th><th scope="col">Cost</th></tr>
        </thead>
        <tbody>
          {Object.entries(status.byFeature).map(([feature, u]) => (
            <tr key={feature}><td>{feature}</td><td>{u.calls}</td><td>{u.inputTokens.toLocaleString()} / {u.outputTokens.toLocaleString()}</td><td>{usd(u.costUsd)}</td></tr>
          ))}
          <tr className="total"><th scope="row">Total</th><td>{status.monthToDate.calls}</td><td>{status.monthToDate.inputTokens.toLocaleString()} / {status.monthToDate.outputTokens.toLocaleString()}</td><td>{usd(status.monthToDate.costUsd)}</td></tr>
        </tbody>
      </table>
      <p className="hint">Model {status.model}. Prices as of {status.pricesAsOf}.</p>
      {status.overSoftCap && <p className="error-text" role="status">You’ve passed your {usd(status.softCapUsd)} monthly warning amount.</p>}
      {status.blocked && <p className="error-text" role="status">Monthly limit reached: AI is paused until next month, and everything works on this device meanwhile.</p>}

      {!status.simulated && (
        <div className="field-row caps">
          <CapField label="Warn me above ($/month)" value={status.softCapUsd} onSave={(v) => run(() => api.ai.setPrefs({ softCapUsd: v ?? 0 }))} />
          <CapField label="Stop above ($/month, empty = no limit)" value={status.hardCapUsd} allowEmpty onSave={(v) => run(() => api.ai.setPrefs({ hardCapUsd: v }))} />
        </div>
      )}
      <p role="status" className="muted">{saved}</p>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  )
}

function CapField({ label, value, onSave, allowEmpty = false }: { label: string; value: number | null; onSave: (v: number | null) => void; allowEmpty?: boolean }) {
  const id = useId()
  const [text, setText] = useState(value === null ? '' : String(value))
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(text.trim() === '' && allowEmpty ? null : Number(text))
      }}
    >
      <label htmlFor={id}>{label}</label>
      <span className="inline-form">
        <input id={id} type="number" min={0} step={0.5} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit">Save</button>
      </span>
    </form>
  )
}
