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
- **File:** `release\Miss Minutes Setup 0.1.0.exe` (112 MB), rebuilt on 2026-10-07 at 12:06
  with Plan my day, the new look and the new clock icon. SHA-256
  `9cedd8fc67a2cd64e6f5e85d071449b553ef3a9b100b92a390cdf2cd8f248f65`.
- **Upgrading later:** run a newer installer over the old one. Your data stays.
- **Install:** per user (no admin). It creates a desktop shortcut and a Start-menu entry.
- **Data:** `%APPDATA%\miss-minutes\missminutes.db`, outside the install folder. **Installed 2026-10-07** (at your request) to `%LOCALAPPDATA%\Programs\Miss Minutes`.
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

## Current state (2026-10-07, latest): the new look, on top of Plan my day
- **The UI now has the retro-futurist "time bureau" look you asked for** (D40, building on D33):
  - every page sits on an amber CRT screen inside a bezel;
  - keycap buttons, nav keys with indicator lamps, and an analog console clock;
  - stamps, a red "Variance" stamp for overdue tasks, "Incoming dispatch" reminders, and a
    glowing timeline;
  - two themes: **Terminal** (dark, the default) and **Office** (light manila), with the switch
    at the top right.
  Layout, wording and behaviour are unchanged.
- **Checks, all passing:**

  | Suite | Result |
  |---|---|
  | Unit tests | 397, plus coverage thresholds |
  | Web end-to-end | 4/4 |
  | Demo end-to-end | 7/7; new: axe on every page in the light theme, and the theme is remembered |
  | Desktop end-to-end | 9/9; new: the bundled fonts load under the app's security policy |
- **Commits 22–24 weren't made yet**, and the new look rewrites the same files as the Plan page
  (`styles.css`, `App.tsx`). The suggested commits below are regrouped to match: core, then UI,
  then docs.

## Earlier state (2026-10-07, later): Plan my day is built
- **Commits 18–21 are yours** (through `c8c850a`). Everything below is uncommitted; see
  commits 22–24.
- **"Plan my day" (M10 part 2) is built**, as you asked: the result is tasks plus calendar blocks,
  with a reminder 5 minutes before each (D39). The flow, on the new **Plan** page:
  1. write tomorrow's to-dos;
  2. **Lay it out on the day** (around your calendar, with breaks);
  3. drag, resize or use the keyboard to adjust;
  4. **Create the plan**;
  5. **Undo** takes it all back.
- **Checks, all passing:**

  | Suite | Result |
  |---|---|
  | Unit tests | 397, plus coverage thresholds |
  | Web end-to-end | 4/4 |
  | Demo end-to-end | 6/6, including the Plan flow: a real drag from the tray, and axe on the board and confirm sheet |
  | Desktop end-to-end | 9/9, including Plan against the fake Google server: Allow calendar blocks, blocks on `me@example.com`, Undo removes them; the packaged app was rebuilt |

  The plan eval baseline was re-run, with identical numbers.
- **Bugs that the new tests caught and that are fixed:**
  - dragging from the tray couldn't work in a real browser (no pointer capture), and pressing
    **Place** could count as a drop;
  - a block write that failed halfway left blocks that Undo didn't know about;
  - a vanished task found halfway through left created tasks outside any batch;
  - an applied plan would have shown each block twice on Today (once as the task, once as
    its calendar event).
- **Installer build:** `npm run dist` failed twice with `EPERM` renaming
  `release\win-unpacked.tmp`. Building to a folder outside the repo worked, so the fresh build
  was copied into `release\`; the installer and `win-unpacked` there are current.
  - **Hypothesis:** something has a handle on `release\`, such as an Explorer window, a shell
    open in that folder, or antivirus scanning it.
  - It isn't your `electron:dev` session, which I left running.
  - If `npm run dist` fails for you, close anything open in `release\` and try again.
- **Your part before real use of calendar blocks:** on the consent screen's Data access page,
  add `.../auth/calendar.events.owned` (README → Plan my day).

## Earlier state (2026-10-07, autonomous session while you're away)
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
1. **You:**
   - look at the new UI (`npm run electron:dev`, or build the demo) and tell me what to push
     further or pull back;
   - commits 22–24 below (push them together);
   - add the `calendar.events.owned` scope;
   - review D39 and D40.
2. **Next: the Claude "arrange with AI" planner** (it sees free intervals only, D18), with the
   greedy arranger as the fallback, plus its eval run (needs your key and OK).
3. Then M11 (polish, the app-name decision, README, release).

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
Commits 1–21 are yours (through `c8c850a`). Commit 22 builds alone; 23 needs 22. Push all three
together.

22. **Add the plan-my-day board and apply/undo core**
    ```powershell
    cd C:\Users\jrhug\Documents\GitHub\miss-minutes
    git add -- src/core/plan src/core/today.ts src/core/today.test.ts src/core/calendar/google.ts src/core/calendar/google.test.ts
    ```
    ```
    Add the plan-my-day board and apply/undo core

    The board is a list of items, each either in the tray or at a time on
    the day, with pure functions for every drag, resize and keyboard nudge,
    all on a 15-minute grid. Auto-arrange runs the greedy planner over the
    tray only, so blocks placed by hand stay put, and can leave a break
    between blocks; both options default to off, so the eval baseline is
    unchanged.

    Applying a plan re-checks it against the calendar as it is now, then
    creates or reschedules the tasks with a reminder before each. The batch
    is saved, with the ids of the calendar blocks it is about to write,
    before any block is written, so Undo can reverse even a half-finished
    apply. A block synced back from Google is hidden on Today when its task
    is already there.
    ```
23. **Add the Plan page and the retro-futurist console look**
    ```powershell
    cd C:\Users\jrhug\Documents\GitHub\miss-minutes
    git add -- src/ui src/App.tsx src/main.tsx src/styles.css src/storage/api.ts src/shared/ipc.ts src/shared/google.ts electron/main.ts electron/ipc.test.ts electron/db/migrations.ts electron/db/batchStore.ts electron/google/oauth.ts electron/google/service.ts e2e-demo/demo.spec.ts e2e-electron/plan.spec.ts e2e-electron/app.spec.ts package.json package-lock.json build scripts/make-icons.mjs public/favicon.svg
    ```
    ```
    Add the Plan page and the retro-futurist console look

    Plan: write the day's to-dos one per line, with lengths like "1h" or
    "30m", and tick tasks already due. They are laid out around the
    calendar on a day timeline, and can be dragged, resized or moved from
    the keyboard; clashes show live and block confirming. Confirming
    creates the tasks at those times with a reminder 5 minutes before, and
    can put the blocks on a Google calendar you own, using
    calendar.events.owned, asked for only when first needed. Undo takes
    back the latest plan. Batches live in SQLite (migration 7).

    Look: the app now sits on an amber CRT screen inside a console, with
    keycap buttons, indicator lamps, an analog clock, rubber-stamp labels
    and a glowing timeline, in the spirit of retro-futurist office tech
    (original art only). A light "office" theme is one switch away. The
    app icon is a matching 1970s console desk clock, drawn as SVG and
    rendered to the installer, window and tray icons. Both
    themes pass axe on every page; effects never lower text contrast and
    stop for reduced motion. The fonts (VT323, IBM Plex Mono; OFL) are
    bundled, so the desktop app stays offline-capable.

    The Plan flow is tested end to end on the desktop against the fake
    Google server, and in the demo with axe.
    ```
24. **Document plan my day and the new look**
    ```powershell
    cd C:\Users\jrhug\Documents\GitHub\miss-minutes
    git add -- README.md DECISIONS.md PROGRESS.md
    ```
    ```
    Document plan my day and the new look

    README gains the Plan my day steps, the calendar-blocks scope and the
    theme switch; DECISIONS gains D39 (plan my day) and D40 (the visual
    identity), both as built and provisional.
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
| M10 | AI: plan my day + eval (validator is a teaching module) | L | ⏳ Plan page, apply, undo and calendar blocks built and tested (greedy engine); Claude planner + eval run next |
| M11 | Polish, README, v1.0.0 release (visual identity done early, D40) | M | ☐ |

## Explain-it-back log
Record each milestone's questions here once you can answer them without notes (questions are
in the session report above and in PLAN.md §7).

## Parking lot
- The on-device parser leaves "remind me" in the title when it appears mid-sentence ("Dentist
  tomorrow remind me 15 minutes before" gives the title "Dentist remind me"). The frozen eval
  baseline must stay as it is, but the user-facing fallback could get a small fix (a separate
  copy) in M11.
- ~~D33 visual identity pass~~ Built 2026-10-07 (D40). Still to decide: the app name before
  the public v1.
- Native Windows toast buttons (snooze in the toast itself, via `toastXml`): post-v1 (D14).
- A "quiet hours" setting (D6 left it optional).
- Plan board: dragging a tray item to a time that's scrolled out of view needs the timeline
  scrolled first (no auto-scroll while dragging). Place and the keyboard cover it.
- Plan blocks: if you later change a planned task's time, its calendar block stays at the old
  time (Undo removes both). Possibly: move the block with the task.
