// The UI's clock: the real one in the app, a FakeClock in tests. `useToday`
// re-renders when the local date changes (at midnight, or after waking from
// sleep), so "Today" and "Overdue" labels never go stale.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { systemClock, type Clock } from '../core/clock'
import { toLocalDate, type LocalDate } from '../core/time'

const ClockContext = createContext<Clock>(systemClock)

export function ClockProvider({ clock, children }: { clock: Clock; children: ReactNode }) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>
}

export function useClock(): Clock {
  return useContext(ClockContext)
}

export function useToday(): LocalDate {
  const clock = useClock()
  const read = () => toLocalDate(clock.now(), clock.zone())
  const [today, setToday] = useState(read)
  useEffect(() => {
    // A cheap check every 30 s handles midnight, sleep and zone changes alike.
    const id = setInterval(() => setToday((prev) => {
      const now = toLocalDate(clock.now(), clock.zone())
      return now === prev ? prev : now
    }), 30_000)
    return () => clearInterval(id)
  }, [clock])
  return today
}
