// Shown only in the hosted web demo, so no visitor mistakes it for a place
// to keep real tasks.

import { useState } from 'react'
import { clearLocalData } from '../storage/api'
import { useApi } from './data'

export function DemoBanner() {
  const api = useApi()
  const [confirming, setConfirming] = useState(false)
  if (!api.isDemo) return null

  const reset = () => {
    try {
      clearLocalData(window.localStorage)
    } catch {
      /* storage blocked: a reload still gives a fresh in-memory demo */
    }
    window.location.reload()
  }

  return (
    <aside className="demo-banner" aria-label="About this demo">
      <p>
        <strong>Demo.</strong> Sample tasks and a generated calendar. Anything you add stays in this browser only. Reminders fire
        only while this tab is open.
      </p>
      {confirming ? (
        <span className="demo-actions">
          <button type="button" className="danger" onClick={reset}>Reset demo data</button>
          <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>Start over…</button>
      )}
    </aside>
  )
}
