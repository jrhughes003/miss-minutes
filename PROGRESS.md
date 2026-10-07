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

## Current state (2026-10-06, second autonomous session)
- M0–M4 are committed and pushed by you.
- **M5 (Google sign-in + Calendar read) is built and fully tested against a local fake Google
  server.** All checks pass on the full working tree:
  - 238 unit tests and coverage thresholds;
  - end-to-end runs: web 4, demo 3, desktop 5 (one of them the Google flow, one the
    rebuilt packaged app).
- **Commit 10 (the M5 code) needs committing and pushing.** Until then, the pushed commit
  `77f5034` doesn't build on GitHub, because it already references the M5 files. See
  "Suggested commits".
- **Not yet done, and only you can do it:** a real sign-in against Google, using the README's
  "Connecting Google Calendar" steps and your client file.
- Paused here at your request, so you can commit. Nothing else is being changed.

## Next up
1. **You:** commit and push commit 10, then commit 11 (docs). Then check that the "Deploy demo"
   workflow publishes https://jrhughes003.github.io/miss-minutes/ and that CI is green.
2. **You:** publish the OAuth consent screen with homepage https://jrhughes003.github.io/miss-minutes/
   and privacy policy https://jrhughes003.github.io/miss-minutes/privacy.html (D29). Then try a
   real connect from the desktop app (`npm run electron:dev`, or reinstall from `release\`).
3. **Next session:** M6 (natural-language capture plus the parse eval). Live Claude runs need
   your API key and cost approval; everything else uses the mock server.

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
Commits 1–9 are yours (through `77f5034`). Pushing commits 10 and 11 together is fine: CI and
Pages build only the final pushed state.

10. **Connect Google Calendar read-only, tested against a fake Google server** (**urgent**:
    makes `77f5034` build again)
    ```powershell
    git add -- electron/db/migrations.ts src/core/recurrence.ts src/core/today.ts src/ui/SettingsView.tsx src/ui/GoogleSettings.tsx src/shared/google.ts src/core/calendar electron/google e2e-electron/google.spec.ts
    ```
    ```
    Connect Google Calendar read-only, tested against a fake Google server

    Sign-in uses the loopback redirect with PKCE; the OAuth client and
    tokens are stored encrypted with safeStorage and never reach the
    renderer. A refresh failure (revoked access, or the 7-day Testing-mode
    limit) becomes a clear "reconnect" state. Selected calendars are
    refetched for a window from 7 days back to 60 ahead, with Google
    expanding repeats, and shown on Today. Rate limits back off
    exponentially with jitter.

    Every test runs against a local fake Google server that checks PKCE,
    scopes, single-use codes, paging and revocation; nothing in the test
    suite contacts Google.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    ```
11. **Document the Google connection**
    ```powershell
    git add -- DECISIONS.md README.md PROGRESS.md
    ```
    ```
    Document the Google connection

    README gains the five-step setup for your own OAuth client. D32
    records how the connection is built: encrypted secrets with no
    plain-text fallback, disconnect deleting all cached calendar data,
    default calendar selection, the sync schedule, and the fake-server
    test strategy.

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
| M6 | AI: NL capture + parse eval (grader is a teaching module) | M | ☐ |
| M7 | AI: task breakdown | S | ☐ |
| M8 | Google Tasks two-way sync | L | ☐ (rules decided in D31) |
| M9 | Calendar write + 📱 phone reminders | M | ☐ |
| M10 | AI: plan my day + eval (validator is a teaching module) | L | ☐ |
| M11 | Polish, README, v1.0.0 release | M | ☐ |

## Explain-it-back log
Record each milestone's questions here once you can answer them without notes (questions are
in the session report above and in PLAN.md §7).

## Parking lot
- Native Windows toast buttons (snooze in the toast itself, via `toastXml`): post-v1 (D14).
- A "quiet hours" setting (D6 left it optional).
