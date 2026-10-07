// Time as a dependency.
//
// Core logic never calls `new Date()` or `Date.now()` (an ESLint rule enforces
// this). It asks an injected Clock instead. Production code passes
// `systemClock`; tests pass a FakeClock they can set and advance, so "three
// days pass while the laptop sleeps" is one line of test code rather than a
// three-day wait.

export interface Clock {
  /** The current instant. */
  now(): Date
  /** The IANA time zone that wall-clock times are interpreted in, e.g. "America/Toronto". */
  zone(): string
}

export const systemClock: Clock = {
  // eslint-disable-next-line no-restricted-syntax -- the one sanctioned read of the real clock
  now: () => new Date(),
  zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
}

/** A clock that only moves when told to. For tests and the eval harness. */
export class FakeClock implements Clock {
  private ms: number
  private tz: string

  constructor(start: string | Date, zone = 'America/Toronto') {
    this.ms = new Date(start).getTime()
    if (Number.isNaN(this.ms)) throw new Error(`FakeClock: invalid start ${String(start)}`)
    this.tz = zone
  }

  now(): Date {
    return new Date(this.ms)
  }

  zone(): string {
    return this.tz
  }

  set(instant: string | Date): void {
    this.ms = new Date(instant).getTime()
  }

  advance(ms: number): void {
    this.ms += ms
  }

  setZone(zone: string): void {
    this.tz = zone
  }
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
