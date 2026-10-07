# Reminder reliability: pre-registered check (PLAN.md §5.3)

- **Date:** 2026-10-06
- **Code:** working tree at the end of M2 (not yet committed)
- **Command:** `MM_PROPERTY_RUNS=10000 npx vitest run src/core/reminders/engine.test.ts -t property`
- **Runtime:** 143 s on the owner's laptop (Windows 11, Node 24.13)

## What each run does
Each of the 10,000 runs generates a random scenario:
- 1–12 reminders over the following week. Each is either at a fixed time or 0 min, 10 min,
  1 h or 1 day before a due time.
- A random walk of the clock with 20–200 steps:
  - 30-second ticks;
  - longer awake gaps of up to 6 h;
  - sleeps of 1–72 h with no ticks at all;
  - time-zone changes.
- Start zones: Toronto, London, Lord Howe (30-minute DST) and UTC.
- Start dates that straddle the March and November DST changes.

## Results against the pre-registered targets
| Property | Target | Result |
|---|---|---|
| Duplicate notifications | 0 | **0** |
| Due reminders never surfaced (on time or in catch-up) | 0 | **0** |
| Fire delay while awake | ≤ 30 s tick (+1 s) | **met.** Every on-time fire landed within the tick it fell due in |
| Each missed reminder shown in catch-up | exactly once | **met** |

All 10,000 runs passed. Everyday `npm test` runs 300 of these scenarios.

## Caveats, stated plainly
- This tests the engine and its fire log against a fake clock. It doesn't test that Windows
  displays the toast: Focus Assist or notification settings can still hide it. That part is
  covered by one real desktop test (`e2e-electron`, a reminder fired with the window hidden)
  and by the in-app "Due reminders" bar, which doesn't depend on Windows.
- During development, the property test caught two flaws in the *test's own* expectations, not
  in the engine:
  1. moving east can make a wall-clock reminder that was still ahead suddenly past, so it fires
     at once as "late";
  2. a reminder that falls due during the final sleep is caught on the closing tick.
  The test was corrected, and the engine code didn't change.
