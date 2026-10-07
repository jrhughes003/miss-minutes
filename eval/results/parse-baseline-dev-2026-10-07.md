# Parse eval: baseline (chrono-node baseline), dev split

- Date: 2026-10-07
- Cases: 124 (110 unambiguous, 14 ambiguous)
- Median latency: 0 ms. Total cost: $0.0000

| Metric | Result | Target (Claude) |
|---|---|---|
| Fully correct (unambiguous) | 72.7 % | >= 95.0 % |
| Confidently wrong date/time | 18.2 % | <= 2.0 % |
| Clarification recall (ambiguous) | 0.0 % | >= 85.0 % |
| False clarification (unambiguous) | 0.0 % | <= 5.0 % |

## Field accuracy (unambiguous cases)

| Field | Accuracy |
|---|---|
| kind | 100.0 % |
| title | 86.4 % |
| due | 81.8 % |
| priority | 100.0 % |
| project | 96.4 % |
| tags | 100.0 % |
| recurrence | 97.3 % |
| reminder | 95.5 % |

## By category (fully correct)

| Category | Correct / cases |
|---|---|
| relative-day | 15 / 15 |
| weekday | 19 / 20 |
| time-of-day | 11 / 25 |
| recurrence | 12 / 16 |
| metadata | 12 / 16 |
| reminder | 5 / 10 |
| ambiguous | 0 / 14 |
| near-midnight | 2 / 4 |
| dst | 3 / 3 |
| no-date | 1 / 1 |

## Failures

- `Email Sam about the budget tomorrow morning` (2026-10-06T10:00 America/Toronto): wrong due
- `Renew my passport tomorrow evening` (2026-10-06T10:00 America/Toronto): wrong due
- `Submit the timesheet for work tomorrow p2` (2026-10-06T10:00 America/Toronto): wrong title, project
- `Email Sam about the budget tomorrow at 10am remind me an hour before` (2026-10-06T10:00 America/Toronto): wrong title, reminder
- `Book flights to Halifax on February 30` (2026-10-06T10:00 America/Toronto): should have asked
- `Book flights to Halifax this Monday` (2026-10-09T16:00 America/Toronto): should have asked
- `Submit the timesheet tomorrow after lunch` (2026-10-09T16:00 America/Toronto): wrong title, due
- `Pay the electricity bill tomorrow afternoon` (2026-10-09T16:00 America/Toronto): wrong due
- `Pick up the dry cleaning tomorrow evening` (2026-10-09T16:00 America/Toronto): wrong due
- `Renew my passport tonight at 12:30` (2026-10-09T16:00 America/Toronto): wrong due
- `Water the plants at midnight on Sunday` (2026-10-09T16:00 America/Toronto): should have asked
- `Call the dentist for work tomorrow p2` (2026-10-09T16:00 America/Toronto): wrong title, project
- `Pick up the dry cleaning tomorrow at 10am remind me an hour before` (2026-10-09T16:00 America/Toronto): wrong title, reminder
- `Renew my passport on February 30` (2026-10-09T16:00 America/Toronto): should have asked
- `Call the dentist this Thursday` (2026-03-07T21:30 America/Toronto): should have asked
- `Pick up the dry cleaning this Friday` (2026-03-07T21:30 America/Toronto): should have asked
- `Pay the electricity bill tomorrow morning` (2026-03-07T21:30 America/Toronto): wrong due
- `Pick up the dry cleaning tomorrow at end of day` (2026-03-07T21:30 America/Toronto): wrong title, due
- `Water the plants tonight at 12:30` (2026-03-07T21:30 America/Toronto): wrong due
- `Submit the timesheet at midnight on Monday` (2026-03-07T21:30 America/Toronto): should have asked
- `Water the plants on the first Monday of every month` (2026-03-07T21:30 America/Toronto): wrong title, due, recurrence
- `Pick up the dry cleaning for work tomorrow p2` (2026-03-07T21:30 America/Toronto): wrong project
- `Water the plants tomorrow at 10am remind me an hour before` (2026-03-07T21:30 America/Toronto): wrong title, reminder
- `Pay the electricity bill on November 31st` (2026-03-07T21:30 America/Toronto): should have asked
- `Water the plants this Friday` (2026-10-31T22:00 America/Toronto): should have asked
- `Renew my passport tomorrow afternoon` (2026-10-31T22:00 America/Toronto): wrong due
- `Submit the timesheet tomorrow evening` (2026-10-31T22:00 America/Toronto): wrong due
- `Pay the electricity bill tomorrow at 10am remind me an hour before` (2026-10-31T22:00 America/Toronto): wrong title, reminder
- `Pick up the dry cleaning on February 30` (2026-10-31T22:00 America/Toronto): should have asked
- `Pick up the dry cleaning this Monday` (2026-03-28T20:00 Europe/London): should have asked
- `Pay the electricity bill this Friday` (2026-03-28T20:00 Europe/London): should have asked
- `Water the plants tomorrow after lunch` (2026-03-28T20:00 Europe/London): wrong title, due
- `Call the dentist tomorrow afternoon` (2026-03-28T20:00 Europe/London): wrong due
- `Email Sam about the budget tomorrow evening` (2026-03-28T20:00 Europe/London): wrong due
- `Pay the electricity bill every weekday` (2026-03-28T20:00 Europe/London): wrong due
- `Pick up the dry cleaning on the first Monday of every month` (2026-03-28T20:00 Europe/London): wrong title, due, recurrence
- `Call the dentist for work tomorrow p2` (2026-03-28T20:00 Europe/London): wrong title, project
- `Pick up the dry cleaning tomorrow at 10am remind me an hour before` (2026-03-28T20:00 Europe/London): wrong title, reminder
- `Renew my passport on February 30` (2026-03-28T20:00 Europe/London): should have asked
- `Call the dentist this Thursday` (2026-12-31T23:00 America/Toronto): wrong due
- `Pay the electricity bill tomorrow morning` (2026-12-31T23:00 America/Toronto): wrong due
- `Pick up the dry cleaning tomorrow at end of day` (2026-12-31T23:00 America/Toronto): wrong title, due
- `Book flights to Halifax on the first Monday of every month` (2026-12-31T23:00 America/Toronto): wrong title, recurrence
- `Submit the timesheet on November 31st` (2026-12-31T23:00 America/Toronto): should have asked
