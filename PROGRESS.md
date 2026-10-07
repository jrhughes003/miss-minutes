# Progress

## Session report – 2026-10-06 (autonomous session)

### Completed, with check status
All four planned milestones are done and verified locally. Nothing is committed (see "Suggested
commits").

| Milestone | Result |
|---|---|
| **M0** Skeleton + CI | Electron 44, React 19, strict TypeScript in both renderer and main process, esbuild for main. Locked-down window (CSP, no navigation, sandbox, typed IPC allow-list). CI workflow written: typecheck/lint, unit tests on Windows and Ubuntu, web e2e with axe, desktop e2e on Windows. |
| **M1** Tasks + storage | Tasks, projects, tags, P1–P4, due date and time, estimates, one level of subtasks, repeat rules (RRULE plus "after completion"). One `TaskService` over SQLite (desktop) and localStorage (web), both passing one shared contract suite. Migrations back the database up before upgrading it. |
| **M2** Reminder engine | Reminders fire from the main process, with the window hidden in the tray. 30 s tick plus immediate checks on resume and unlock. Catch-up summary after sleep. Snooze, Done and Dismiss from a "Due reminders" bar. Start-at-login setting. |
| **M3** Today view + installer | Overdue / All day / Schedule (tasks, reminders, a "now" line; calendar events supported in the model, ready for M5) / Inbox. **Installer built, not installed** (see "Ready to install"). |

Check status at the end of the session (all run on your machine):
- `npm run check`: typecheck ✅, lint ✅, **197 unit tests ✅**
- `npm run coverage`: thresholds met ✅. `src/core` has **99.6 % lines and 93.8 % branches**
  (targets 90 / 85); the whole project has 89 % lines.
- `npm run test:e2e`: **4/4 ✅** (web build in Chromium, axe: 0 serious or critical violations,
  a phone-width layout check).
- `npm run test:electron`: **4/4 ✅**, covering:
  - the security bridge;
  - SQLite persisting across a restart;
  - a real reminder fired with the window hidden;
  - the **packaged** app starting from `release/win-unpacked`.
- **Pre-registered reminder reliability check (PLAN §5.3): 10,000 random scenarios of sleep,
  DST and zone changes. 0 duplicates and 0 lost reminders.** Details:
  `eval/results/reminders-2026-10-06.md`.
- **Not verified:** CI on GitHub, because nothing has been pushed. Each suggested commit was
  also not checked on its own; only the final tree was.

### Ready to install
- **File:** `release\Miss Minutes Setup 0.1.0.exe` (111 MB), SHA-256
  `83b15bfdd4ed7d08381f70e20610ea82eeb65beaae94e27bda853223c595701e`.
- **Install:** per user (no admin). It creates a desktop shortcut and a Start-menu entry.
- **Data:** `%APPDATA%\Miss Minutes\missminutes.db`, outside the install folder.
- **The installer is unsigned,** so Windows SmartScreen will warn: choose "More info" → "Run
  anyway".
- **Start at login:** on first launch the app registers itself to start hidden at sign-in. This
  is the default from D15; turn it off in Settings if you prefer.
- **Close vs. quit:** closing the window keeps Miss Minutes in the tray (that's what keeps
  reminders firing). Use **Quit** in the tray menu to stop it.
- **Not done by me, per your rules:** I didn't install it, and the packaged smoke test didn't
  register a login item or write to `%APPDATA%`. I checked both afterwards.

### Partially done
Nothing is half-built. M4 hasn't started. It needs GitHub Pages, which means pushing, which is
yours to do.

### Provisional decisions to review (DECISIONS.md): all accepted by owner on 2026-10-06
- **D26:** SQLite through Node's built-in `node:sqlite` instead of `better-sqlite3`. This
  removes the native-module rebuild that financeflow has to do. Wall-clock ↔ instant conversion
  uses `Intl` instead of a time-zone library.
- **D27:** finishing an overdue repeating task skips ahead to today instead of creating a
  backlog of overdue copies.
- **D28:** task rules, including subtasks, completing parents, deleting projects (tasks move to
  the Inbox), no COUNT in repeat rules, and Google Tasks length limits.
- **D29 (part):** a small privacy page on the demo site in M4. It's needed to publish the OAuth
  app.
- **D30:** reminder design:
  - reminders are stored on their task;
  - the fire log is keyed by wall-clock time;
  - the "scheduled at" guard;
  - Google-compatible limits (5 per task, up to 4 weeks before);
  - no buttons on Windows notifications (use the "Due reminders" bar instead);
  - grouping of simultaneous and missed reminders.
- **M5 plan (in "Open questions" below):** import the OAuth client JSON once through Settings
  and store it encrypted.

### Open questions for you
1. ~~**D13:** the Google Tasks merge rules~~ **Decided on 2026-10-06 (D31):** Miss Minutes wins same-field conflicts; for deletions, unchanged → delete both, edited → keep and restore; Inbox ↔ "My Tasks". M8 is unblocked.
2. **Google OAuth client:** see the item below. It stays in Testing until the Pages URL exists
   (D29), and the import plan needs your OK.
3. **"A local copy on my desktop":** I took this to mean the installed app with a desktop
   shortcut (D24). If you meant something else, say so.

### Explain-it-back questions (M0–M3)
Answer these without notes before you consider each milestone yours. The answers are in the code
comments and DECISIONS.md.

| M | Questions |
|---|---|
| M0 | Why `contextIsolation`, a sandbox and a preload bridge rather than giving the page Node? What stops a compromised page calling `fs:readFile` over IPC? (Two checks: the preload's channel list, and the sender-origin check in `electron/ipc.ts`.) Why does CI test on Windows? |
| M1 | Why store "08:00 on Tuesday" as wall-clock text plus a zone instead of a UTC instant? What does the app do with 02:30 on spring-forward day, and with 01:30 on fall-back day, and why (RFC 5545)? How do migrations keep an installed user's data safe (forward-only, `VACUUM INTO` backup, refusing newer schemas)? Why do SQLite and localStorage share one contract test suite? |
| M2 | How do we avoid duplicate reminders after sleep? (The compare-and-set claim in the fire log, *then* notify.) Why a 30 s tick instead of one `setTimeout` per reminder? Why key the log by wall-clock time, not UTC? What did the 10,000-run property test check, and what can't it check (whether Windows displays the toast)? |
| M3 | Why is an all-day event's end date exclusive, and what bug would treating it as inclusive cause? Why is "today" computed from the user's zone, not UTC (a task at 21:00 in Toronto is already "tomorrow" in UTC)? Why does the packaged-app test exist when the dev-app tests already pass? |

### Former D21 modules: an honest status, plus walkthroughs of their nearest equivalents
The two former D21 modules (`eval/parse/grader.ts` in M6 and `src/core/plan/validate.ts` in
M10) **haven't been written yet**, because this session stopped at M3 as you scoped it. They'll
be built as teaching modules (D25) when those milestones come.

The two modules from this session that play the same role are the ones you'll most likely be
asked about, so here are short walkthroughs of those:

1. **`src/core/time.ts` → `resolveLocal(date, time, zone)`** converts "02:30 on 2026-03-08 in
   Toronto" into a real instant.
   - Treat the wall time as if it were UTC (`naive`). The true instant is `naive − offset`, but
     the offset depends on the instant, which is circular.
   - Any one wall time is near at most one DST change, so there are only two candidate offsets:
     the one in force a day before and the one a day after.
   - Try both and keep the candidates that read back as the requested wall time:
     - **one match:** an ordinary time;
     - **two matches:** a fall-back overlap, so keep the earlier one;
     - **no match:** a spring-forward gap, so use the pre-gap offset, which lands an hour later,
       as RFC 5545 specifies.
   - Proof it works: property tests over random instants from 1990 to 2060 in six zones, including
     Lord Howe's 30-minute shift.
2. **The reminder engine (`src/core/reminders/planner.ts` + `engine.ts`)** is built from three
   ideas:
   - **Poll, don't schedule.** Every tick asks the same question: "what's due by now that
     hasn't fired?". On-time reminders, missed ones after sleep, and ones missed during a
     restart all go through one code path.
   - **Claim, then notify.** A fire is recorded first with a compare-and-set (a single SQL
     `INSERT … ON CONFLICT DO UPDATE … WHERE`). Only the caller whose claim succeeded shows a
     notification, so duplicates are impossible by construction. A crash can lose at most one
     notification, and the reminder still waits in the app's bar.
   - **Key by wall-clock time** (`rule|2026-10-08T13:15`). A zone change or the repeated
     fall-back hour can't produce a second key, so neither can produce a second notification.

## Current state (2026-10-07, autonomous session while you're away)
- M0–M7 are committed and pushed; CI is green, the live demo works, and the OAuth app is in
  production.
- **M8 (Google Tasks two-way sync) and M9 (📱 phone reminders) are built**, both tested against
  the fake Google server. All checks pass:
  - 352 unit tests and coverage thresholds;
  - end-to-end: web 4/4, demo 5/5, desktop 8/8 (including the Tasks sync and phone-reminder
    flows; the packaged app was rebuilt).
- **Tasks sync:**
  - 16 rule tests, 17 integration tests, and a randomized two-sided convergence test (150
    scenarios per run; a 500-scenario run passed);
  - the tests caught one real bug, an outbox that matched by time across two clocks. It's fixed
    (D36).
- **Phone reminders:** each 📱 reminder becomes an event with a popup on the app's own "Miss
  Minutes reminders" calendar, using only the narrow `calendar.app.created` scope. Writes are
  idempotent and tested never to touch other calendars (D37).
- **Your part before real use:**
  1. enable the **Google Tasks API**;
  2. on the consent screen's Data access page, add the scopes `.../auth/tasks` and
     `.../auth/calendar.app.created`;
  3. in the app, turn each feature on and click its "Allow" button (README);
  4. check that a 📱 reminder actually alerts your phone.
- Still waiting on your key and your OK on cost: the Claude parse and breakdown evals.
- **M10 groundwork is done, in new files only** (so commits 18–20 stay valid):
  - the free-time finder;
  - the greedy planner;
  - the **plan validator**, the second former-D21 teaching module (walkthrough below);
  - a frozen 200-day plan eval.
  Greedy baseline: 0 % violations, 99.1 % of due-today tasks scheduled, 100 % of overloaded
  days handled (`eval/results/plan-greedy-2026-10-07.md`). 368 unit tests pass.

### Walkthrough: the plan validator (`src/core/plan/validate.ts`)
It decides whether a proposed day plan is *possible*, whoever proposed it.
- **Everything is interval arithmetic** on instants, with one test at the core: two half-open
  intervals [a1, a2) and [b1, b2) overlap exactly when a1 < b2 and b1 < a2. Touching ends
  (one block ending at 11:00 and the next starting at 11:00) are fine.
- **Each block is checked against the rules in turn:**
  - a real task, used once;
  - at least 15 minutes long;
  - inside the planning window and not before now;
  - not overlapping busy time (busy intervals are merged first);
  - finished by the deadline (the due time, or the end of the due day);
  - at most estimate × 1.25 (floored at 15 minutes).
- **Then the plan as a whole:** blocks are sorted by start, so overlapping blocks can only be
  neighbours and one pass finds them. Every candidate must be scheduled or listed as
  unscheduled, so nothing silently disappears.
- **Why measure violations when the app blocks them anyway?** Because the rate shows how
  trustworthy the model's planning really is. PLAN §5.2 sets ≤ 5 % before validation and 0 %
  after it.
- **The tests read as its specification:** one test per rule, a DST-day test, and a property
  test proving the greedy planner never trips it.

## Next up
1. **You:** commits 18–21 below, then push them together.
2. **Next: M10 part 2:**
   - the Claude plan prompt (free intervals only);
   - the "Plan my day" UI with a proposed timeline;
   - apply with confirmation and undo, which needs `calendar.events.owned` (re-consent once);
   - the Claude plan eval (your key and OK).
3. Then M11 (polish, the D33 visual identity, README, release).

## Open questions for owner
- ~~D13 (the Google Tasks merge rules)~~ Decided on 2026-10-06 in D31. M8 is unblocked.
- **Google OAuth client (M5 prerequisite): done by you on 2026-10-06.** The file is
  `Documents\GitHub\minutes_credentials.json.json`, outside the repo, so git can't see it. It's
  a Desktop-type (`installed`) client, which is correct for D9. Only its structure was checked;
  no values were read into any file.
  1. ~~Is the consent screen's publishing status In production?~~ **Answered on 2026-10-06:
     it's in Testing.** You'll publish it once the GitHub Pages URL exists (M4), which gives
     the consent screen its homepage and privacy-policy links. Until then, Google sign-in
     during M5 development expires every 7 days, so re-consent weekly; that's expected (D29).
  2. Planned handling (provisional, reversible): at M5 the app gets a Settings → "Import Google
     OAuth client" button. It reads this JSON once and stores the client ID and secret encrypted
     with `safeStorage`, so the app never reads a loose file path at runtime and nothing
     credential-like is bundled into the installer.

## Notes and known issues
- **Fixed this session:** the first desktop test runs (M0/M1) let Electron create
  `%APPDATA%\miss-minutes` (cache plus a test database). That folder was created at 21:04
  that day and contained only test artifacts, so it was deleted. Tests now set
  `MISS_MINUTES_USER_DATA`, which also blocks login-item registration, and `electron:dev` uses
  `.dev-user-data/`. Checked at the end of the session: no `%APPDATA%` folder and no
  startup-registry entry exists.
- `npm audit` reports issues only in dev-only tooling: `shell-quote` inside `concurrently`, and
  `sprintf-js` in electron-builder's download chain. None ship in the app (it has no runtime
  dependencies; everything is bundled). Not force-fixed, because that would downgrade major
  versions.
- TypeScript is pinned to `~6.0.3`. TypeScript 7 is out, but typescript-eslint supports only
  versions below 6.1.
- If a shell has `ELECTRON_RUN_AS_NODE=1` set (VS Code's extension host does), Electron starts
  as plain Node. `scripts/run-electron.mjs` and the desktop tests strip it.
- Port 4173 (Vite's default preview port) is often in use by another project's preview server,
  so the web end-to-end tests use port 4317 and never reuse an existing server.
- Node 24.13 prints an `ExperimentalWarning` for `node:sqlite` during `npm test`. It's harmless
  (D26).
- `npm run test:electron` shows one real Windows notification ("Stretch your legs") per run.
- The installer is unsigned (no code-signing certificate), so SmartScreen warns on first run.
- Downloads made during the session went outside the repo in only two cases:
  - `npm install` populated Electron's binary cache (`%LOCALAPPDATA%\electron\Cache`), as any
    Electron project's install does;
  - Playwright reused browsers already in `%LOCALAPPDATA%\ms-playwright`, and nothing new was
    downloaded.
  electron-builder's tools were cached inside the project (`node_modules/.cache`).

## Suggested commits (in order; nothing is staged or committed)
Commits 1–17 are yours (through `081cd8d`). M8 and M9 share files, so these three are cut by
layer and must be **pushed together** (commit 18 alone doesn't build). CI checks only the pushed
head, which passed every check here.

18. **Add the Google Tasks sync engine**
    ```powershell
    cd C:\Users\jrhug\Documents\GitHub\miss-minutes
    git add -- src/core/sync electron/google/tasksSync.ts electron/google/tasksSyncStore.ts electron/google/tasksSync.test.ts electron/google/fakeGoogle.ts electron/google/api.ts electron/db/migrations.ts
    ```
    ```
    Add the Google Tasks sync engine

    Each synced task keeps a snapshot of the fields both sides last agreed
    on, and each sync merges field by field against it: a change made on
    one side is taken, edits to different fields on both sides both
    survive, and a same-field conflict keeps the local value and logs what
    Google had (D31). A task deleted on one side is deleted on both unless
    the other side edited it, in which case the edit is kept and the task
    restored.

    Changes are found with Google's own timestamps, so a skewed PC clock
    cannot hide them, and uploads go through an outbox so an ambiguous
    insert is matched to the task Google created rather than sent twice.
    The rules are a pure module with property tests; the engine is tested
    against a fake Google Tasks server, including a randomized run of edits
    on both sides that must always converge.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    ```
19. **Turn on Tasks sync and phone reminders from Settings**
    ```powershell
    cd C:\Users\jrhug\Documents\GitHub\miss-minutes
    git add -- src/core/reminders/phone.ts src/core/reminders/phone.test.ts src/core/calendar/google.ts electron/google/phoneMirror.ts electron/google/phoneMirror.test.ts electron/google/calendarSync.ts electron/google/oauth.ts electron/google/service.ts electron/ipc.test.ts electron/main.ts src/shared/google.ts src/shared/ipc.ts src/storage/api.ts src/styles.css src/ui/GoogleSettings.tsx src/ui/tasks/ReminderField.tsx src/ui/tasks/TaskEditor.tsx e2e-electron/googleTasks.spec.ts e2e-electron/phone.spec.ts
    ```
    ```
    Turn on Tasks sync and phone reminders from Settings

    Both are off until switched on, and each asks Google only for what it
    needs, when it is needed: Tasks access for sync, and calendar.app.created
    for phone reminders, which lets the app manage its own calendar and
    nothing else.

    A reminder marked with the phone switch becomes a short event with an
    alert on a "Miss Minutes reminders" calendar, so the phone notifies even
    when the PC is off. Event ids are derived from the reminder and its
    occurrence, so a retry can never duplicate one; each sync creates,
    updates and deletes until the calendar matches. That calendar is kept
    out of Today and the calendar picker, and everything on it is removed
    when phone reminders are turned off.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    ```
20. **Document Tasks sync and phone reminders**
    ```powershell
    cd C:\Users\jrhug\Documents\GitHub\miss-minutes
    git add -- README.md
    ```
    ```
    Document Tasks sync and phone reminders

    README gains the setup steps for Tasks sync and phone reminders. (The
    matching decisions, D36 and D37, are committed with the next commit,
    which also carries DECISIONS.md and PROGRESS.md.)

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    ```
21. **Lay the groundwork for plan my day: free time, a greedy planner and a validator**
    ```powershell
    cd C:\Users\jrhug\Documents\GitHub\miss-minutes
    git add -- src/core/plan eval/plan eval/results/plan-greedy-2026-10-07.md package.json DECISIONS.md PROGRESS.md
    ```
    ```
    Lay the groundwork for plan my day: free time, a greedy planner and a validator

    Free time is the planning window minus merged busy time, and is all
    plan-my-day will ever tell Claude about the calendar. The validator
    defines a possible plan: real tasks once each, inside the window and
    after now, clear of meetings and of each other, done by each deadline,
    and not wildly over estimate; the app will refuse any plan it rejects.

    The greedy planner (earliest deadline, then priority) is the fallback
    and the baseline. On a frozen set of 200 generated days, including both
    DST changes and 34 overloaded days, it breaks no rule, schedules 99.1 %
    of due-today tasks and lists what it cannot fit. A property test over
    1,000 random days confirms the validator never rejects its plans.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    ```

## Milestones
| # | Milestone | Size | Status |
|---|---|---|---|
| M0 | Skeleton + CI | S | ✅ done locally (CI not yet run on GitHub) |
| M1 | Tasks + storage (incl. recurrence) | M | ✅ done locally |
| M2 | Reminder engine | M | ✅ done locally (10,000-run reliability check passed) |
| M3 | Today view + first desktop install | S–M | ✅ done locally; installer ready, not installed |
| M4 | Web demo + Playwright/axe + privacy page | M | ✅ done locally (deploy needs you to push and turn on Pages) |
| M5 | Google sign-in + Calendar read | L | ✅ built and tested against a fake Google server; real sign-in check is yours |
| M6 | AI: NL capture + parse eval (grader is a teaching module) | M | ✅ built; baseline measured; Claude run needs your key and OK |
| M7 | AI: task breakdown | S | ✅ built; eval needs your key and OK |
| M8 | Google Tasks two-way sync | L | ✅ built and tested against a fake server; real-account check is yours |
| M9 | Calendar write + 📱 phone reminders | M | ✅ phone reminders built and tested against a fake server; real phone check is yours; own-calendar writes move to M10 |
| M10 | AI: plan my day + eval (validator is a teaching module) | L | ⏳ part 1 done (core, validator, eval, greedy baseline); part 2 next |
| M11 | Polish, README, v1.0.0 release (includes the D33 visual identity pass) | M | ☐ |

## Explain-it-back log
Record each milestone's questions here once you can answer them without notes (questions are
in the session report above and in PLAN.md §7).

## Parking lot
- The on-device parser leaves "remind me" in the title when it appears mid-sentence ("Dentist
  tomorrow remind me 15 minutes before" gives the title "Dentist remind me"). The frozen eval
  baseline must stay as it is, but the user-facing fallback could get a small fix (a separate
  copy) in M11.
- D33 visual identity pass (Loki/TVA-inspired retro-futurism, original art only). Also decide
  on the app name before the public v1.
- Native Windows toast buttons (snooze in the toast itself, via `toastXml`): post-v1 (D14).
- A "quiet hours" setting (D6 left it optional).
