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

### Provisional decisions to review (DECISIONS.md)
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
1. **D13:** the Google Tasks merge rules are still pending. They block only M8.
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

## Current state (2026-10-06, end of the autonomous session)
- M0–M3 are done locally; see the session report above. M4 is next.
- Git repository initialized. **Nothing is committed or staged.**

## Next up
1. **You:** review the provisional decisions, answer the open questions, and commit the slices
   below. Optionally install the app from `release\`.
2. **You:** create the GitHub repo and push, which triggers the first CI run.
3. **Next session, M4:** the fake-calendar generator, demo seeding, the privacy page, and the
   GitHub Pages deploy workflow. After that you can publish the OAuth app (D29).

## Open questions for owner
- D13 (the Google Tasks merge rules) is still pending. It blocks M8 only.
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
These are layered so each commit depends only on earlier ones: docs → tooling → core → storage
→ main process → UI. Each takes whole files in their **final** state. Only the full tree was
verified by the checks, not each intermediate commit. If an intermediate commit fails CI, fold it
into the next one.

1. **Plan Miss Minutes before writing any code**
   - Files: `CLAUDE.md`, `PLAN.md`, `DECISIONS.md`, `PROGRESS.md`, `README.md`, `LICENSE`
   - Message:
     ```
     Plan Miss Minutes before writing any code

     Miss Minutes is the third app in the suite: to-dos, reminders and Google
     Calendar in one desktop app, with optional Claude-powered capture,
     breakdown and day planning. These documents fix the scope, the
     architecture and the evaluation targets before any results exist, so the
     targets can't drift toward whatever the first runs happen to show.

     DECISIONS.md records each decision with the options weighed; the ones
     made without the owner are marked PROVISIONAL. The Google facts behind
     them (7-day refresh tokens in Testing status, the Tasks API discarding
     due times, no Tasks sync token) were checked against Google's
     documentation on 2026-10-06.

     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     ```
2. **Scaffold the desktop app with a locked-down window and CI**
   - Files: `.gitignore`, `.gitattributes`, `package.json`, `package-lock.json`,
     `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`,
     `vitest.config.ts`, `eslint.config.js`, `playwright.config.ts`,
     `playwright.electron.config.ts`, `index.html`, `public/favicon.svg`, `scripts/` (all),
     `build/` (icons), `src/main.tsx`, `src/vite-env.d.ts`, `src/test/setup.ts`,
     `src/shared/csp.ts`, `electron/security.ts`, `e2e/smoke.spec.ts`,
     `.github/workflows/ci.yml`
   - Message:
     ```
     Scaffold the desktop app with a locked-down window and CI

     Electron, React and strict TypeScript, with the main process in
     TypeScript too and bundled to CommonJS by esbuild (D7). The same CSP is
     sent as a header by the desktop app and baked into the built HTML for
     the web demo; navigation away from the app's own page and new windows
     are blocked, and permission requests are refused.

     CI runs typecheck and lint, unit tests with coverage on Windows and
     Ubuntu, the web build in Chromium with axe accessibility checks, and the
     real desktop app on Windows. The app icon is drawn by a small script
     using only Node's zlib, so it can be regenerated without an image tool.

     Two environment quirks are handled in scripts rather than left to bite:
     an inherited ELECTRON_RUN_AS_NODE (set by VS Code) is stripped before
     launching Electron, and end-to-end tests use their own port so they can
     never test another project's preview server by mistake.

     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     ```
3. **Add wall-clock time, DST handling and repeat rules**
   - Files: `src/core/clock.ts`, `src/core/clock.test.ts`, `src/core/time.ts`,
     `src/core/time.test.ts`, `src/core/recurrence.ts`, `src/core/recurrence.test.ts`
   - Message:
     ```
     Add wall-clock time, DST handling and repeat rules

     Tasks store wall-clock times ("08:00 on Tuesday") and convert them to
     instants only when needed, in one place. A time that falls in the
     spring-forward gap moves forward by the gap; a time that happens twice
     at fall-back resolves to the first occurrence, as RFC 5545 specifies.
     Property tests check both rules over random instants from 1990 to 2060
     in Toronto, London, Lord Howe (a 30-minute shift) and others.

     Repeat rules are iCalendar RRULEs, the format Google Calendar uses,
     expanded by the rrule library in floating time so it never applies DST
     itself. Finishing a long-overdue repeating task skips ahead to today
     instead of leaving a backlog of overdue copies (D27).

     Core code reads time only from an injected Clock; a lint rule rejects
     new Date() and Date.now() there, so every time-dependent test controls
     time exactly.

     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     ```
4. **Add the task, reminder and Today rules as pure core logic**
   - Files: `src/core/tasks/` (all), `src/core/reminders/` (all), `src/core/settings.ts`,
     `src/core/settings.test.ts`, `src/core/today.ts`, `src/core/today.test.ts`
   - Message:
     ```
     Add the task, reminder and Today rules as pure core logic

     TaskService holds every task rule: validation at Google Tasks' limits,
     subtasks one level deep, completing a repeating task creates its next
     occurrence with its reminders, deleting a project moves its tasks to the
     Inbox. It runs over a small storage port, so the same rules serve the
     desktop app and the web demo.

     The reminder planner is a pure function, "what is due by now that has
     not fired?", so missed reminders after sleep, a restart or a zone
     change take the same path as on-time ones. The engine claims each fire
     in a log keyed by rule and wall-clock time before notifying, so a race,
     a restart or the repeated hour at fall-back cannot repeat a reminder.
     The pre-registered check ran 10,000 random scenarios of sleeps, DST and
     zone changes: no duplicates, nothing lost.

     The Today model merges overdue, all-day and timed tasks, reminders and
     calendar events, treating an all-day event's end date as exclusive the
     way Google does.

     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     ```
5. **Store tasks and the reminder log in SQLite and localStorage**
   - Files: `electron/db/` (all), `src/storage/localRepo.ts`, `src/storage/localRepo.test.ts`,
     `src/storage/localReminderLog.ts`, `src/storage/localReminderLog.test.ts`,
     `src/test/repoContract.ts`, `src/test/reminderLogContract.ts`,
     `eval/results/reminders-2026-10-06.md`
   - Message:
     ```
     Store tasks and the reminder log in SQLite and localStorage

     Two stores, one contract: SQLite for the desktop app and localStorage
     for the web demo pass the same test suites, so they can't drift apart.
     The reminder log's claim is a single conditional upsert in SQLite, so
     the database itself enforces "fire at most once".

     SQLite comes from Node's built-in node:sqlite rather than
     better-sqlite3 (D26), which removes the native-module rebuild between
     tests and the packaged app. Schema changes go through numbered
     migrations; an existing database is copied with VACUUM INTO before any
     upgrade, a failed migration rolls back completely, and a database from a
     newer app version is refused rather than opened.

     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     ```
6. **Run reminders from the tray over a typed IPC contract**
   - Files: `src/shared/ipc.ts`, `electron/ipc.ts`, `electron/ipc.test.ts`,
     `electron/taskHandlers.ts`, `electron/reminders.ts`, `electron/main.ts`,
     `electron/preload.ts`
   - Message:
     ```
     Run reminders from the tray over a typed IPC contract

     The renderer reaches the main process only through window.api, and
     every channel it can call is listed in src/shared/ipc.ts: the preload
     rejects anything else, the main process refuses requests from any page
     but our own, and a channel without a handler is a compile error.
     Validation errors cross the boundary with their field intact.

     The reminder engine runs in the main process: a 30-second poll plus
     immediate checks on resume and unlock, so reminders fire with the
     window closed and are caught up after sleep. Closing the window hides
     the app to the tray; the installed app can start at sign-in. Tests and
     dev runs redirect the user-data folder and never register a login item.

     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     ```
7. **Add the Today, Tasks and Settings screens**
   - Files: `src/storage/api.ts`, `src/storage/runtime.ts`, `src/storage/runtime.test.ts`,
     `src/ui/` (all), `src/App.tsx`, `src/App.test.tsx`, `src/styles.css`,
     `e2e/tasks.spec.ts`, `e2e-electron/` (all)
   - Message:
     ```
     Add the Today, Tasks and Settings screens

     Today shows what is overdue, what is on today (all-day, then a timed
     schedule with reminders and a "now" line) and what is waiting in the
     Inbox. Tasks covers projects, tags, priorities, due dates and times,
     estimates, repeat rules, steps and reminders. Fired reminders wait in a
     "Due reminders" bar with Done, Snooze and Dismiss, because Windows
     notifications cannot carry buttons.

     The same screens run in the browser over localStorage, where reminders
     use the Notification API while the tab is open; permission is asked
     only when the first reminder is added.

     axe found the P2 colour below 4.5:1 on the selected-row tint; it is now
     at least 5.3:1 on every light background. Desktop end-to-end tests cover
     SQLite across a restart, a reminder fired with the window hidden, and
     the packaged app itself.

     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     ```

## Milestones
| # | Milestone | Size | Status |
|---|---|---|---|
| M0 | Skeleton + CI | S | ✅ done locally (CI not yet run on GitHub) |
| M1 | Tasks + storage (incl. recurrence) | M | ✅ done locally |
| M2 | Reminder engine | M | ✅ done locally (10,000-run reliability check passed) |
| M3 | Today view + first desktop install | S–M | ✅ done locally; installer ready, not installed |
| M4 | Web demo + Playwright/axe + privacy page | M | ☐ next (deploy needs you to push) |
| M5 | Google sign-in + Calendar read | L | ☐ (OAuth client ready; Testing status) |
| M6 | AI: NL capture + parse eval (grader is a teaching module) | M | ☐ |
| M7 | AI: task breakdown | S | ☐ |
| M8 | Google Tasks two-way sync | L | ☐ (blocked on D13) |
| M9 | Calendar write + 📱 phone reminders | M | ☐ |
| M10 | AI: plan my day + eval (validator is a teaching module) | L | ☐ |
| M11 | Polish, README, v1.0.0 release | M | ☐ |

## Explain-it-back log
Record each milestone's questions here once you can answer them without notes (questions are
in the session report above and in PLAN.md §7).

## Parking lot
- Native Windows toast buttons (snooze in the toast itself, via `toastXml`): post-v1 (D14).
- A "quiet hours" setting (D6 left it optional).
