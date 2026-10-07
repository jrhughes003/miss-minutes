import { describe, expect, it } from 'vitest'
import type { MissMinutesApi } from '../shared/ipc'
import { detectBridge } from './runtime'

describe('detectBridge', () => {
  it('uses the Electron bridge when the preload exposed one', () => {
    const api = { isElectron: true } as MissMinutesApi
    expect(detectBridge({ api })).toBe(api)
  })

  it('falls back to browser storage without a bridge', () => {
    expect(detectBridge({})).toBeNull()
    expect(detectBridge(undefined)).toBeNull()
  })
})
