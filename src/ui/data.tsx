// React glue for the data API: a context (so tests can supply their own API)
// and a hook that loads data and reloads it whenever something changes.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api as defaultApi, toAppError, type AppError, type ChangeScope, type DataApi } from '../storage/api'

const DataContext = createContext<DataApi>(defaultApi)

export function DataProvider({ api, children }: { api: DataApi; children: ReactNode }) {
  return <DataContext.Provider value={api}>{children}</DataContext.Provider>
}

export function useApi(): DataApi {
  return useContext(DataContext)
}

export interface Live<T> {
  data: T | undefined
  error: AppError | null
  reload: () => void
}

/**
 * Runs `load` now, again whenever `deps` change, and again after any data
 * change in one of `scopes`.
 *
 * `deps` must be JSON-serializable (ids, filters). They're compared by value
 * through a string key, so callers can pass fresh arrays on every render. A
 * superseded request's result is dropped, so a slow old response can't
 * overwrite a newer one.
 */
export function useLive<T>(load: (api: DataApi) => Promise<T>, deps: unknown[], scopes: ChangeScope[] = ['tasks', 'projects']): Live<T> {
  const api = useApi()
  const key = JSON.stringify(deps)
  const scopeKey = scopes.join(',')
  const [state, setState] = useState<{ data: T | undefined; error: AppError | null }>({ data: undefined, error: null })
  const [tick, setTick] = useState(0)

  // Keep the latest `load` without making it an effect dependency (callers
  // pass a new arrow function every render).
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let current = true
    loadRef.current(api).then(
      (data) => current && setState({ data, error: null }),
      (e: unknown) => current && setState((s) => ({ data: s.data, error: toAppError(e) })),
    )
    return () => {
      current = false
    }
  }, [api, key, tick])

  useEffect(() => {
    const wanted = new Set(scopeKey.split(','))
    return api.onChange((scope) => {
      if (wanted.has(scope as ChangeScope)) setTick((t) => t + 1)
    })
  }, [api, scopeKey])

  return { data: state.data, error: state.error, reload: () => setTick((t) => t + 1) }
}
