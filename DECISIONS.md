# Decisions

Each entry gives the options considered, the choice made and the reason. **Source** says who made
the call: *user* (answered in the planning session on 2026-10-06), *default* (proposed by Claude
because the question was not answered; open to override) or *design* (a technical call made
while planning). Google facts were checked against Google's docs on 2026-10-06, and model facts
against Anthropic's model table cached on 2026-09-25.

To change a decision, add a new entry that supersedes the old one. Don't edit history.

---

## Product

### D1. Name and location (user)
**Choice:** "Miss Minutes", repo folder `miss-minutes/`, installed product name `Miss Minutes`,
appId `com.missminutes.app`. "For now": renaming before the first `npm run dist` is free;
renaming after it requires migrating the data folder (see CLAUDE.md invariants).

### D2. Platform: desktop app, with phone reminders through Google Calendar (user, option b)
- **Options:**
  - (a) desktop only;
  - (b) desktop plus selected reminders mirrored to Google Calendar as events with popup alerts;
  - (c) a sync backend or phone app.
- **Choice:** (b).
- **Why:** it gets reminders onto the phone with no server to run or secure. (c) would roughly
  double the project.
- **Consequence:** phone reminders need calendar write access (D7) and only reach the phone when
  Google syncs, so delivery is a little less exact than on the desktop. The rule: a reminder
  marked 📱 creates an event on a dedicated "Miss Minutes" calendar (D8).

### D3. AI features in v1: capture, task breakdown, plan my day (user)
- **Ranked:**
  1. Natural-language capture: most daily value, cheapest, easiest to evaluate.
  2. Task breakdown: small and self-contained.
  3. Plan my day: highest value, but the most complex and needs calendar read + write.
  4. Q&A / weekly review: deferred to post-v1.
- **Why plan-my-day is last:** it depends on calendar sync, free-slot computation and the
  confirm-then-write flow, so it lands after those exist.

### D4. Task model (default; question 6 answered "default")
- **Priorities:** four levels, P1–P4, with P4 as "none".
- **Organization:** projects (one per task) plus free-form tags.
- **Recurrence:** iCal RRULE strings (the same format Google Calendar uses), plus a "repeat
  after completion" mode (`every 3 days after done`).
- **Today view:**
  - overdue items;
  - tasks due today, including those with no time set;
  - timed reminders and calendar events from all selected calendars, merged on one timeline;
  - an "Inbox" strip for undated tasks.
- **Subtasks:** one level deep, which matches what Google Tasks can represent.

### D5. Imports (default; question 4 not asked separately)
**Choice:** the first Google Tasks sync acts as the import (all existing tasks come in). A
one-off CSV import is post-v1.
**Why:** the user's tasks already live in Google Tasks, so a separate importer adds nothing yet.

### D6. Time zones and day window (user + default)
- **User:** rarely changes time zones, and wants reminders across the full day rather than only
  working hours.
- **Choice:**
  - Reminders can be set for any time of day, 24/7. There are no default quiet hours (an
    optional setting comes later).
  - Planning window for plan-my-day: 07:00–22:00 every day, editable per weekday.
  - Time-zone policy: wall-clock reminders ("08:00" stays 08:00 local) interpreted in the
    system's current zone. If the zone changes, wall-clock items move with it and fixed-instant
    items (meetings) don't.
- **Why:** it matches how a person thinks about "remind me at 8". Travel is rare, so no travel
  mode is needed.

---

## Architecture

### D7. Stack: same as financeflow, except the main process is written in TypeScript (design)
- **Options:**
  - (a) copy financeflow exactly (main process in `.cjs`);
  - (b) the same stack with the main process in strict TypeScript, bundled to CJS with esbuild;
  - (c) Tauri.
- **Choice:** (b).
- **Why:** reuse financeflow's patterns: the storage module that picks localStorage or IPC at
  runtime, the `contextBridge` preload bridge (`window.api`), `safeStorage` encryption, the
  mock API server and the payload allow-list. TypeScript in the main process lets the IPC
  contract, the sync code and the scheduler share types with the UI, and the brief asks for
  strict TS. Tauri would mean learning Rust and dropping all that reuse.
- **Cost:** one small build step (esbuild). File names become `.ts` (for example
  `electron/ai/payload.ts`).

### D8. Phone reminder channel: a dedicated app-created calendar (design)
- **Options:**
  - (a) write reminder events into the primary calendar;
  - (b) rely on Google Tasks due-date notifications;
  - (c) use a secondary calendar "Miss Minutes" that the app creates.
- **Choice:** (c). Each 📱 reminder becomes a 15-minute event with
  `reminders.overrides=[{method: popup, minutes: 0}]`, tagged
  `extendedProperties.private.mmId=<local id>`.
- **Why:**
  - (b) can't work for timed reminders: the Tasks API discards the time part of `due`.
    Date-only tasks notify around 09:00, according to Google Tasks Help (unverified).
  - (a) clutters the user's real calendar.
  - With (c) the user can hide or recolor the calendar, the scope stays narrow
    (`calendar.app.created`), and clean-up is trivial.
- **To verify in M9:** popup overrides on API-created events do show on the phone. Google's docs
  imply this but don't say it outright.

### D9. Google OAuth (design; facts verified 2026-10-06)
- **Flow:**
  - an installed-app ("Desktop") OAuth client;
  - the system browser opens Google's consent page;
  - the redirect comes back to a loopback address (`http://127.0.0.1:<random port>`);
  - PKCE (S256) protects the exchange.
- **Why this flow:** Google recommends the loopback redirect for desktop apps. Custom URI
  schemes and the copy-and-paste "OOB" flow are no longer supported. The client secret of a
  desktop client is *not* confidential, so PKCE is what prevents a stolen authorization code
  from being exchanged.
- **Token handling:** access and refresh tokens are encrypted with `safeStorage` and stay in the
  main process only.
- **Publishing status: "In production", unverified, for the user's own Google Cloud project.**
  - In "Testing", refresh tokens for Calendar and Tasks scopes expire 7 days after consent,
    which would force a weekly sign-in.
  - Unverified production status shows a one-time warning screen and caps the app at 100 new
    users over the project's lifetime. That is irrelevant for one user.
  - Other people who run the app bring their own OAuth client ID (documented in the README).
  - Google allows at most 100 refresh tokens per account per client, and going over silently
    revokes the oldest. Reuse the stored refresh token; never re-consent in a loop.

### D10. Google scopes, requested in stages as milestones need them (design)
| Stage | Scopes | What they allow |
|---|---|---|
| M5 read | `calendar.calendarlist.readonly`, `calendar.events.readonly` | list calendars; read events on every selected calendar, including shared ones |
| M8 tasks | `tasks` | two-way Google Tasks sync |
| M9 write | `calendar.events.owned`, `calendar.app.created` | create and edit events on calendars the user owns; create the "Miss Minutes" calendar |
- **Why staged:** each consent screen asks only for what the current feature needs, which is
  easier to justify on the consent screen and in interviews.
- **Rejected:** the full `calendar` scope, which also grants ACL and settings access we don't
  need.
- **Open question for the user:** do you need to *write* to calendars you don't own (for example
  a shared family calendar where you have write access)? `events.owned` doesn't allow that. If
  yes, swap it for `calendar.events`.
- Google's docs don't state which of these scopes are classed "sensitive". Assume they all are,
  and check the Cloud Console scope picker during M5.

### D11. Calendar sync: fetch a fixed window, with Google expanding repeats (design)
- **Options:**
  - (a) incremental sync with a `syncToken` per calendar, storing recurring masters and
    expanding the RRULE locally;
  - (b) refetch a window every few minutes (`timeMin = today − 7d`, `timeMax = today + 60d`,
    `singleEvents=true`) and replace that window in the local cache.
- **Choice:** (b) for v1. Option (a) is noted as a post-v1 optimization.
- **Why:**
  - `singleEvents=true` lets Google expand recurring events and their exceptions; each
    instance carries `recurringEventId` and `originalStartTime`. We never re-implement
    Google's recurrence rules on Google's data.
  - Sync tokens can't be combined with `timeMin`/`timeMax`.
  - Volume is tiny: a few calendars, polled every 5 minutes and when the window gains focus.
    The per-user quota is 600 requests/minute, so this is far from any limit.
  - The trade-off is a few hundred kB of extra traffic per day.
- **Rules:**
  - All-day events use `start.date`/`end.date` and the end date is *exclusive*. Store them as
    dates, never as midnight instants.
  - Cancelled instances are removed.
  - On 403 `usageLimits` or 429, back off exponentially with jitter (random spread), up to 64 s.

### D12. Calendar writes: owned calendars only, single events only, always confirmed (design)
- **Create:** the client chooses the event ID (derived from the local proposal ID), so retrying
  a create can't make a duplicate. The `id` field rules need checking against the docs in M9.
- **Edit:** allowed for events on owned calendars, applied to *single instances only*. Changing
  a whole recurring series opens the event in Google Calendar via `htmlLink`.
- **Delete:** only events the app created (`mmId` tag).
- **Confirmation:** every write goes through a confirmation sheet that shows exactly what will
  change. After applying, an "Undo last apply" option is available.

### D13. Tasks: SQLite is the source of truth, synced two ways with Google Tasks (user + design)
- **Storage (user):** tasks live in SQLite and sync with Google Tasks.
- **Mapping:**
  - each project ↔ a Google task list;
  - title, notes (up to 8192 chars), due date, status and parent sync both ways;
  - priority, tags, due *time*, reminders, recurrence rule and estimate are **local only**,
    because the Tasks API has no fields for them.
  - Recurring tasks: only the current occurrence is mirrored. Completing it in Google completes
    it locally, and the app then creates the next occurrence.
- **Detecting changes:** the Tasks API has no sync token. Poll `tasks.list` with
  `updatedMin = lastSync − 1 min`, `showDeleted`, `showHidden` and `showCompleted`, paging 100
  at a time.
- **Merging (three-way, field by field):** a snapshot of each task as last synced is the common
  ancestor.
  - If only one side changed a field, that side wins.
  - If both changed the same field, the local value wins and the conflict is logged and shown
    in a sync panel.
  - ETags are stored but treated as advisory, since Google doesn't document `If-Match` for
    Tasks.
- **Idempotency:** the Tasks API can't take a client-chosen ID. An outbox row is written
  *before* each insert. If the outcome is unknown (a crash or timeout), the next sync adopts a
  remote task with the same title and parent created after the outbox time, instead of
  inserting again.
- **Rejected:** last-writer-wins on the whole task (it loses edits) and Google as the source of
  truth (it would lose priority, tags and times).

### D14. Reminder engine (design)
- **How it fires:** the main process runs a tick loop every 30 s, plus an immediate check on
  `powerMonitor` `resume` / `unlock-screen` and on app start. Each check fires reminders with
  `fire_at ≤ now` and `state = pending`.
- **Why not one long timer per reminder:** sleep makes `setTimeout` drift, and timers longer
  than about 24.8 days overflow.
- **No duplicates:**
  - Firing writes a `reminder_fires` row with UNIQUE(`reminder_id`, `occurrence_at`) in the
    same transaction that marks the reminder `fired`.
  - The notification is shown only after the commit.
  - A crash between commit and display can therefore lose at most one notification, and the
    Today view still shows it as fired. Losing one is preferred over duplicating.
- **Catch-up:** reminders missed by more than 2 minutes (because of sleep or the app being
  closed) are collected into one "You missed 3 reminders" notification that opens a list.
  Each missed reminder is surfaced exactly once.
- **Snooze:** sets a new `fire_at` (5 min, 1 h, tomorrow 09:00, or a custom time).
  Electron's notification action buttons are macOS-only, so on Windows, clicking the
  notification opens a small snooze/done popover. Native Windows toast buttons through
  `toastXml` are post-v1.
- **Daylight saving time (DST):**
  - When a wall-clock time doesn't exist (a spring-forward gap), the reminder fires at the same
    offset after the gap, as RFC 5545 specifies.
  - When a time occurs twice (fall-back), it fires on the first occurrence only.

### D15. Background behaviour (design)
- **Window close:** closing the window hides the app to the tray. "Quit" is in the tray menu.
- **Start on login:** `app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })` is on
  by default and can be turned off in settings.
- **Single instance:** a single-instance lock is used, so two copies can't both fire reminders.
- **Windows notifications:** `app.setAppUserModelId('com.missminutes.app')` must be set, or
  Windows notifications fail silently.
- **Focus Assist:** if Windows Focus Assist is likely to hide notifications, the app says so in
  its settings.

### D16. Date and time libraries (design)
- **Options:** Luxon; date-fns v4 with `@date-fns/tz` (what financeflow uses); the Temporal
  polyfill.
- **Choice:**
  - date-fns v4 + `@date-fns/tz` for zone maths;
  - `rrule` for RRULE expansion, run in "floating" (zone-less local) time and converted to
    instants by our own code;
  - `chrono-node` as the deterministic natural-language date parser.
- **Why:** consistency with financeflow, and they're small. Converting floating times to
  instants keeps all the DST logic in one module, which the fake-clock tests cover.
- **Revisit** if the DST property tests (PLAN §5.3) expose library bugs.

---

## AI

### D17. Models: cheapest first, upgrade only when the eval shows it's needed (design; user asked for the cheaper model on routine calls)
- **Starting point:** `claude-haiku-4-5` ($1 / $5 per million input/output tokens) for all
  three features.
- **Plan my day:** may move to `claude-sonnet-5-5` ($2 / $10) only if Haiku misses the
  pre-registered plan-my-day targets *and* Sonnet meets them.
- **Opus:** not used.
- **Where they're set:** model IDs live in one config object, checked against Anthropic's docs
  at each AI milestone.
- **Structured output:** use **structured outputs** (`output_config.format`, a JSON schema) or
  `strict: true` tools, **not** forced `tool_choice`. Current Sonnet 5.5 and Opus 5.5 reject
  forced tool choice with a 400 error. Haiku 4.5 and Sonnet 5.5 both support structured outputs,
  so switching models needs no code change.
- **Note for financeflow:** it uses forced `tool_choice` with `claude-sonnet-5` and
  `claude-opus-5`. That works today but will break if those IDs are bumped to the 5.5 models.

### D18. What each AI feature may send (design)
**Calendar event titles, attendees and locations are never sent.** Plan my day sends only free
time windows, computed locally. The field-by-field table is in PLAN §4.

### D19. AI usage display and caps (user: "show me usage")
- **Logging:** every call logs feature, model, input/output/cache tokens, latency and estimated
  cost to an `ai_usage` table. Cost comes from a local price table with an "as of" date.
- **Settings → AI usage:** this month's calls, tokens and cost by feature, plus a 30-day chart.
- **Caps:**
  - an optional monthly soft cap (warning), default $2;
  - an optional hard cap (AI turns off until the month resets), default off.
- **Demo:** shows simulated usage from the mock responses, labelled "simulated".

### D20. Web demo (user: mocked AI)
- **Data:** localStorage.
- **Calendar:** a seeded fake-calendar generator. It provides three calendars (Work, Personal,
  Family) with recurring meetings, all-day events, an exception to a recurring series and a
  DST-week case, generated relative to "today" so the demo never looks stale.
- **AI:** mocked from recorded fixtures, so visitors need no key and incur no cost.
- **Reminders:** fire through the browser Notification API, only while the tab is open (the
  demo says so).
- **Google:** no real Google connection, ever.
- **Hosting:** GitHub Pages (default).

---

## Process

### D21. Modules the user writes personally (default)
- **Modules:**
  - the plan-my-day constraint checker (`src/core/plan/validate.ts`);
  - the NL-parse eval grader (`eval/parse/grader.ts`).
- **Why these:** both are pure functions with a crisp spec, they sit at the heart of the
  evaluation story the user will be asked about, and they suit an engineering-statistics
  background (interval overlap, scoring rules). Claude writes the specs and test cases first,
  then reviews.
- **Rejected:** recurrence rules. They involve too much DST/RFC trivia to be a good first module,
  and a library already handles them.

### D22. Testing and CI (design)
- **Unit tests:** Vitest, with fake timers and an injected `Clock`.
- **Property-based tests:** `fast-check`, which generates thousands of random cases (here:
  random schedules, sleeps and DST changes).
- **End-to-end tests:** Playwright with `@axe-core/playwright` on the web demo.
- **CI:** GitHub Actions on `windows-latest` (the user's platform) and `ubuntu-latest`.
- **Mock servers for tests:** a mock Anthropic server, copied from financeflow, and a **fake
  Google server** that serves Calendar and Tasks responses from the fake-calendar generator.
  They let sync and OAuth-refresh paths be tested without real accounts.

---

## Approvals (2026-10-06)

### D23. Plan approved, with resolutions (user)
- **Approved as written:**
  - v1 scope and the "Later" list
  - main process in TypeScript (D7)
  - production, unverified OAuth status (D9)
  - Haiku-first models with eval-driven ship rules (D17)
  - the two modules you write personally (D21)
- **D10 open question resolved:** writes go only to calendars you own, so the scope stays
  `calendar.events.owned`. Shared calendars stay read-only.
- **D6 home zone:** `America/Toronto` (Hamilton, Ontario; EST/EDT). This is the default zone for
  the app and the demo. The parse and reminder evals include Toronto DST cases (second Sunday of
  March and first Sunday of November), alongside Europe/London and Australia/Lord_Howe.
- **D20 hosting confirmed:** GitHub Pages.
- **D13 (Tasks three-way merge and the local-only fields):** not yet explicitly approved. It
  stays as the working default until you confirm or change it, at the latest before M8.

### D24. Local desktop install (user: "a local copy on my desktop")
- **Choice:** a Windows NSIS installer built with electron-builder.
  - `createDesktopShortcut: true` and a Start-menu entry.
  - Per-user install, no admin rights needed.
  - Data in `%APPDATA%\Miss Minutes\missminutes.db`.
- **Timing:** the first installable build ships at the end of **M3**, not M11, so you can use
  reminders and the Today view daily while the Google and AI milestones are built.
- **Updates:** a "deploy the update to my installed instance" procedure, the same as
  financeflow's: back up the database, `npm run dist`, run the installer. It gets added to
  CLAUDE.md at M3.
- **Why:** using the app daily from early on surfaces real reminder-reliability problems long
  before the release.

### D25. Claude writes the former D21 modules (user; supersedes D21)
- **Change:** the user decided Claude should write `src/core/plan/validate.ts` and
  `eval/parse/grader.ts`, instead of writing them personally.
- **Requirement:** each module must be easy to learn from:
  - a header comment explaining the reasoning;
  - comments at every non-obvious step;
  - tests thorough enough to read as the specification;
  - a short walkthrough in the session report covering that module.
- **Effect on the README:** the planned "How this was built" section no longer claims the user
  wrote them (PLAN.md §7).

## Made during the autonomous session (2026-10-06)

### D26. SQLite through Node's built-in `node:sqlite`; time zones through `Intl` (design; accepted by owner 2026-10-06)
- **Options:**
  - (a) `better-sqlite3`, as in financeflow and D7;
  - (b) `node:sqlite`, built into Node 24 and Electron 44.
- **Choice:** (b).
- **Why:** `better-sqlite3` is a native module compiled for one runtime at a time. financeflow
  has to rebuild it whenever it switches between `npm test` (Node) and `npm run dist`
  (Electron). `node:sqlite` needs no compilation and no rebuild, and nothing has to be
  unpacked from the installer. It was checked working on 2026-10-06 in Node 24.13, in Electron
  44.6 run as Node, and in the Electron 44.6 main process (SQLite 3.53).
- **Risk:** Node still labels `node:sqlite` "experimental" (a warning in Node 24.13; Electron's
  24.21 prints none).
- **Easy to reverse:** the code depends only on a tiny `prepare/run/get/all/exec` interface,
  which `better-sqlite3` also satisfies. Swapping back changes one file
  (`electron/db/database.ts`).
- **Also:** time-zone conversion uses the built-in `Intl` API in `src/core/time.ts` instead of
  `@date-fns/tz` (D16). The DST policy is then explicit, and it's covered by property tests over
  Toronto, London, Lord Howe and others. `date-fns` and `@date-fns/tz` turned out to be unused
  and were removed at M3. Formatting uses `Intl.DateTimeFormat`.

### D27. Finishing an overdue repeating task skips ahead to today (design; accepted by owner 2026-10-06)
- **Rule:** the next occurrence is the first one after the current due date. If that is still
  in the past, the next is the first occurrence on or after today, keeping the rule's cadence:
  "every 2 weeks on Tuesday" stays on the same alternating Tuesdays.
- **Why:** finishing a daily task that's been overdue for a week shouldn't leave six overdue
  copies behind. Todoist and Google Calendar behave the same way.
- **Alternative:** strict schedule, where the next is always the one after the current due
  date, even if it's in the past.

### D28. Task rules (design; accepted by owner 2026-10-06)
- **Subtasks:**
  - one level deep, always in the parent's project;
  - a subtask can't repeat (its parent can).
- **Completing:**
  - completing a parent completes its open subtasks;
  - completing a repeating task keeps the done copy and creates the next occurrence as a new
    task. Its subtasks are copied as open, so a repeating checklist works;
  - completing an already-done task changes nothing (idempotent).
- **Deleting:**
  - deleting a task deletes its subtasks;
  - deleting a project moves its tasks to the Inbox.
- **Repeat rules:**
  - an RRULE may not contain COUNT, because each completion re-anchors the rule. Use an end
    date (UNTIL) instead;
  - no repeats more often than daily.
- **Limits:** title 1024 chars and notes 8192, matching Google Tasks so every task can sync.
  Tags are lower-case with no `#`, at most 20 per task.


### D30. How reminders are modelled and fired (design; accepted by owner 2026-10-06)
These refine D14 and were made while building M2.
- **Reminders live on their task** as a list of rules: "N minutes before due" or "at a fixed
  date and time".
  - A repeating task's next occurrence carries its "before due" rules automatically. Fixed-time
    rules stay with the occurrence they were set on.
  - There are no standalone reminders. "Remind me to X" is a task with a reminder, which is
    also how AI capture (M6) will produce them.
- **The fire log is keyed by (rule, wall-clock occurrence time),** for example
  `r1|2026-10-08T13:15`, not by the UTC instant. As a result:
  - a time-zone change doesn't re-fire a reminder that has already fired;
  - the repeated hour at fall-back fires once;
  - moving the task's time creates a new occurrence, which does fire.
- **Each rule records when it was scheduled.** Occurrences earlier than that are skipped, so
  setting a reminder for a time already past, or moving a task into the past, doesn't trigger
  a burst of "missed" notifications. Moving the due date re-arms "before due" rules from now.
- **Limits match Google Calendar's popup reminders:** at most 5 per task, at most 4 weeks
  before. Every reminder can then be mirrored to the phone in M9 unchanged.
- **Windows notifications carry no buttons** (Electron's notification actions are
  macOS-only). Clicking one opens the app at the "Due reminders" bar, which offers Done, three
  snoozes (10 min, 1 hour, tomorrow at the all-day time) and Dismiss.
- **More than 3 reminders due in the same tick become one grouped notification.** Missed
  reminders always become a single "You missed N reminders" notification.
- **Login item:** registered only by the installed app (`app.isPackaged`). In development it
  would register the bare `electron.exe`.
- **Browser demo:** the same engine runs in the page and uses the browser's Notification API.
  Permission is requested the first time a reminder is added, never on page load.

### D29. OAuth stays in Testing until the demo site is live (user, 2026-10-06; refines D9)
- **State:** the user's Google Cloud OAuth client (Desktop type) exists and is in **Testing**.
- **Plan:** publish it to **In production** (unverified) once the GitHub Pages site from M4 is
  live, so the consent screen can link to a real homepage and privacy policy.
- **Consequences:**
  - M4 gains a small static **privacy page** on the demo site (accepted by owner
    2026-10-06). It covers what the desktop app stores locally, what it sends to Google and
    Anthropic, and how to disconnect.
  - Any M5 work done before publishing hits the 7-day refresh-token expiry. The app must treat
    an `invalid_grant` on refresh as "please reconnect", not as a crash. Building that handling
    is needed anyway, because users can revoke access at any time.

### D31. Google Tasks sync rules confirmed and completed (user, 2026-10-06; finalizes D13)
D13 stands as written, with three additions. M8 is no longer blocked.
- **Same-field conflicts: Miss Minutes wins** (option a, as in D13).
  - If both sides changed the same field since the last sync, the local value is kept and
    written back to Google.
  - The overwritten Google value is recorded in the sync log, so nothing is lost silently.
  - Rejected: "most recent edit wins". The timestamps come from different devices' clocks, so
    close calls would be decided by clock drift.
- **Deletions:**
  - Deleted on one side and **unchanged** on the other (compared with the last-sync snapshot):
    delete on both sides.
  - Deleted on one side and **edited** on the other: keep the edited task, and recreate it on
    the side that deleted it. Losing an edit is worse than a task reappearing. Each such case
    is recorded in the sync log.
  - Completing a task is not deleting it. A completed task syncs as completed. Google's
    "cleared" (hidden) completed tasks stay completed locally and are not deleted.
- **Inbox ↔ the default Google list:** tasks with no project sync to the user's default list
  ("My Tasks"). Each project maps to its own Google task list, created on first sync if
  missing.
- **Tests M8 must include:** a property test over random sequences of edits, deletes and
  completions on both sides. After two sync rounds with no further edits, both sides must
  agree, no task may be duplicated, and every lost local or remote value must appear in the
  sync log.

### D32. How the Google connection is built (design, M5; PROVISIONAL – needs owner review)
- **Importing the client:** Settings has an "Import client file…" button. The page reads the
  JSON file you pick and hands its text to the main process once. The main process validates it
  (it must be a "Desktop app" client) and stores the client ID and secret encrypted. The app
  never reads a file path at runtime. The secret passes through the page once, which is
  acceptable because Google treats a desktop client's secret as non-confidential (D9).
- **Storing secrets:** they go in the settings table, encrypted with `safeStorage` (Windows
  DPAPI). If encryption isn't available, nothing is stored. There is no plain-text fallback.
- **Disconnecting:** the app revokes the grant at Google, then **deletes every cached calendar
  and event** locally.
- **Which calendars start selected:** a calendar seen for the first time is selected if it's
  your primary calendar or shown in Google Calendar's own sidebar. After that, your choice in
  Miss Minutes is kept. Free/busy-only calendars can't be selected, because they have no
  details to show.
- **When sync runs:** on start, every 5 minutes, after connecting, after selecting a calendar,
  and when the window gains focus (at most once a minute). Concurrent syncs share one run.
- **When the grant stops working:** if refreshing returns `invalid_grant` (access revoked, or
  the 7-day Testing-mode limit from D29), the tokens are deleted and Settings shows "Reconnect".
- **Testing:** every Google request goes through injected endpoints. Tests use a local fake
  server (`electron/google/fakeGoogle.ts`) that checks PKCE, scopes, single-use codes, revoked
  refresh tokens and paging, and can inject 429 errors. A test-only "headless consent" mode
  works only when the endpoints are overridden, so it can never be used against Google itself.
- **Not yet verified:** a sign-in against the real Google service. That's the owner's check,
  using the steps in the README.

### D33. Visual direction: the retro-futurist "TVA" look from Loki (user, 2026-10-06; built 2026-10-07, see D40)
- **The ask:** the UI should feel like the technology in the *Loki* TV series, which is what
  inspired the name.
- **What that style is, in design terms:** 1970s retro-futurist bureaucratic tech.
  - Warm amber / orange-on-dark phosphor screens with a slight CRT glow and scanline texture.
  - Chunky, boxy beige-and-brown hardware panels with bevelled edges.
  - Monospaced or condensed "terminal" type for data, with a friendlier display face for
    headings.
  - Analog clock motifs.
  - "Timeline" visuals, which suit the Today schedule well.
  - Stamped labels and case-file styling for task cards.
  - Mechanical feedback (dials, toggles) for settings.
- **How it maps onto the app:**
  - The Today timeline becomes the centrepiece "timeline".
  - Reminders arrive as "dispatches".
  - Overdue items get a red "variance" treatment.
  - A dark amber theme is the default, with a light "office paper" theme as the alternative.
- **Constraints (non-negotiable for a public portfolio repo):**
  - **No Marvel/Disney assets.** No screenshots, logos or fonts taken from the show, and no
    likeness of the Miss Minutes character. Evoke the *style* with original art only. The clock
    icon in `build/` is already original.
  - **Accessibility still wins:** WCAG AA contrast in both themes. CRT effects are decoration
    only, are subtle, and are switched off under `prefers-reduced-motion` and in high-contrast
    mode. axe checks keep running on every screen.
- **Risk to decide before the public v1 (M11):** "Miss Minutes" is the name of a Marvel
  character. Using it as the name of a published app could draw a trademark complaint. The name
  was chosen "for now" (D1). Options:
  - keep it for the private build only, and publish under a different name;
  - pick a nod-but-distinct name;
  - accept the risk knowingly.
  Renaming is cheap until the first public release. After that, the installed app's data folder
  is tied to `productName` (see CLAUDE.md).
- **When:** a "visual identity" pass, planned as part of M11 (polish), or as its own short
  milestone before M11 if the owner prefers. Tokens in `src/styles.css` are already centralised,
  so most of the restyle is a theme swap plus a few components.

### D34. Natural-language capture as built (design, M6; PROVISIONAL – needs owner review)
- **Always a preview, except for plain sentences.** A sentence with a date, repeat, priority,
  tag, project or reminder shows an editable card before anything is saved. A sentence with
  nothing to understand ("Buy milk") is added at once, like the old quick-add. Clarifying
  questions get an answer box and a retry.
- **Capture always works.** Without a key, with AI switched off, at the hard spending cap, or
  when the API errors, the on-device parser answers, and the card says which one did and why
  ("Understood on this device", "…Claude is rate-limited…").
- **The baseline was frozen before results:** `chrono-node` plus light glue, written before
  any eval run and not tuned afterwards, even where the dev results showed obvious weaknesses
  (for example "morning" = 06:00, or "every weekday" starting on a Saturday). It's the honest
  comparison point, not a strawman, and it's the user-facing fallback.
- **Model use:** `claude-haiku-4-5` with structured outputs (`output_config.format`, a Zod
  schema), not forced tool choice (D17). The reply is validated again in code. An invalid date
  becomes a question, and an unknown project, invalid priority, malformed time or invalid RRULE
  is dropped.
- **Usage log:** per call, it records feature, model, tokens, cost, latency and success. It
  never records the prompt or the reply. The soft cap defaults to $2/month (warning only),
  and there is no hard cap until the user sets one.
- **API key:** the shape is checked (`sk-ant-…`) before saving, it's stored encrypted, and it's
  never returned to the page.
- **Mock vs. simulated:**
  - The desktop app can point at a local mock Anthropic server (`MISS_MINUTES_AI_BASE_URL`,
    `npm run ai:mock`) for development and tests. It's labelled "Development mode".
  - The web demo simulates AI in the page and is labelled "Simulated", with estimated usage.
  - Neither can be mistaken for real results. The eval runner names any run against a local
    server "mock" and says "NOT a real model".
- **Case-set size:** the frozen parse eval has **248** cases (124 dev, 124 test), not the
  "about 160" in PLAN §5.1. The templates were crossed with six reference moments, which gave
  more coverage of DST and week boundaries. The targets are unchanged.
- **Optimistic toggles:** every checkbox that saves to the main process (calendars, "Use
  Claude", "Start at login") flips at once and reverts on error (`src/ui/OptimisticToggle.tsx`).
  A round-trip delay had made clicks look ignored. It was found twice by end-to-end tests and
  fixed once for all.

### D35. Task breakdown as built (design, M7; PROVISIONAL – needs owner review)
- **Suggestions, never automatic.** "Suggest steps" in the task editor shows a checklist of
  proposed steps, all ticked by default. Only "Add selected steps" creates subtasks, and
  "Discard" leaves the task untouched.
- **No fallback that invents steps.** Without AI (no key, AI off, at the limit, an API error),
  the app says why and leaves steps to be added by hand, as PLAN §4 specifies. A canned on-device
  "breakdown" would look like help without being any.
- **What's sent:** the title, notes (with an "Include notes" switch, on by default), the
  project name and the due date, per the allow-list. The editor states this next to the button.
  The task is looked up by id in the main process, so the page can't send arbitrary data.
- **Shape checks:** steps are filtered through `core/breakdown/checks.ts` before being shown:
  - 3–7 steps;
  - each starts with an instruction verb (approximated by excluding articles, pronouns,
    "-ing" forms and similar);
  - at most 80 characters;
  - no numbering;
  - no duplicates;
  - no dates the task didn't mention (detected with `chrono-node`).
- **The eval (PLAN §5.4):** 40 vague tasks, frozen 2026-10-07. The shape checks run on the raw
  output (target 100 %). The runner also writes a rating sheet for the 20 hand-rated tasks.
  Not run yet: it needs your key (about $0.04).
- **Mock and demo:** the mock server and the web demo use the same generic, clearly labelled
  steps ("Suggested by simulated AI (no real model)").

### D29 update (user, 2026-10-07)
The OAuth app is now **In production** (unverified). Its homepage is
https://jrhughes003.github.io/miss-minutes/ and its privacy policy is `/privacy.html`, with
`jrhughes003.github.io` as the authorized domain. The 7-day Testing-mode token expiry no longer
applies. Google shows a one-time "unverified app" warning at sign-in, as expected.

### D36. Google Tasks sync as built (design, M8; PROVISIONAL – needs owner review)
Implements D13 and D31. The rules are in `src/core/sync/tasksMerge.ts`, a pure module with a
full explanation at the top, and are carried out by `electron/google/tasksSync.ts`.
- **Off until you turn it on.** Settings → Google Calendar → "Sync my tasks with Google Tasks".
  The `tasks` scope is requested only then ("Allow Google Tasks access"), as staged in D10.
  Turning sync off forgets the mapping and keeps every task on both sides.
- **The first sync introduces open tasks only,** in both directions. Years of completed history
  on either side are not copied across. Tasks that were already synced keep syncing whatever
  their state.
- **Lists:**
  - the Inbox maps to the default list;
  - each project maps to a list of the same name, matched case-insensitively or created;
  - a Google list with no matching project creates one here.
  If either the list or the project is deleted, that project's sync stops (it's "detached"),
  its tasks are kept, the log says so, and the list is never silently re-created.
- **Changes since last time** are found with `updatedMin` set to each list's high-water mark
  (the newest `updated` time Google has reported) minus 1 second. This uses Google's clock
  rather than ours, so a skewed PC clock can't hide changes.
- **Inserts are idempotent through the outbox:**
  - a row is written before each insert and removed when the new id is mapped;
  - inserts are never retried automatically after a server error (only after rate limits);
  - an unresolved row is matched to the task Google actually created, by list, title and
    parent, never by time, again because clocks can differ.
  This matching was originally time-based, and the integration test caught it producing a
  duplicate when the two clocks disagreed. Fixed before commit.
- **The due date syncs; the time of day stays local.** When Google moves the date, the local
  time is kept. If Google clears the date of a repeating task (which needs one), the local
  version is kept, sent back, and logged.
- **Completing a repeating task in Google** completes it here, through TaskService, so the next
  occurrence is created and then sent to Google.
- **A project change here** moves the task to the right list (Tasks `move` with
  `destinationTasklist`). Moving a task between lists in Google appears to us as a delete plus
  a create, and is handled by the deletion rules.
- **Sync log** in Settings: conflicts (with the value Google had), deletions, restored tasks,
  adopted uploads, list changes and errors.
- **When it runs:** with the calendar sync (every 5 minutes, on focus, on "Sync now"), and
  10 seconds after a local edit (debounced).
- **Testing:**
  - 16 rule tests and 2 property tests on the pure merge;
  - 17 integration tests against the fake Google Tasks server, one per rule;
  - a randomized convergence test: random edits, completions, deletions and new dates on both
    sides over several sync rounds. Both sides must agree, nothing may be duplicated, and no
    open task may be left unsynced. 150 scenarios run by default, and a 500-scenario run passed
    on 2026-10-07;
  - a desktop end-to-end test with headless consent.
- **Not yet verified:** a real Google account. Your check needs the Tasks API enabled and the
  `tasks` scope added (README).
- **Known limits (post-v1):**
  - renaming a project or list doesn't rename its counterpart;
  - subtasks of subtasks from Google are flattened to one level;
  - the per-task order (`position`) isn't synced.

### D37. Phone reminders as built (design, M9; PROVISIONAL – needs owner review)
Implements D2/D8.
- **The narrowest scope that works:** phone reminders need only `calendar.app.created`, which
  lets the app create *its own* calendar and manage events on it, and nothing on your other
  calendars. It's requested only when you turn phone reminders on ("Allow phone reminders").
  Write access to your own calendars (`calendar.events.owned`) waits for M10, when
  plan-my-day first needs it. D10's staging is unchanged in spirit; only the order moved.
- **How it works:**
  - a reminder you mark 📱 (a switch on each reminder in the task editor, shown once phone
    reminders are active) becomes a 15-minute event on "Miss Minutes reminders";
  - the event has a popup alert at its start, is marked *transparent* (it never counts as busy)
    and is tagged with the rule and occurrence;
  - the desktop notification still fires as well.
- **Idempotent writes (D12):**
  - the event id is derived from the rule and occurrence (`mm` + SHA-256 hex, which is valid
    base32hex);
  - Google refuses a duplicate create (409), which is answered with an update, so a crash between
    creating and recording can never leave two events;
  - a content hash avoids pointless updates.
- **Converges every sync:** creates what's missing, updates what changed, and deletes events whose
  reminder is gone, done, moved or past. Occurrences are mirrored up to 60 days ahead. Only events
  this app created are touched, and only on its own calendar (tested).
- **Kept out of view:** the app's calendar is excluded from the calendar picker and from Today,
  where it would duplicate reminders.
- **Turning it off** deletes every mirrored event, and so does disconnecting Google.
- **The confirm-before-writing rule (D12)** is met by the explicit 📱 tick. No other write to
  Google happens in M9.
- **Not yet verified:** that the popup actually arrives on your phone. That's your check, and it
  needs the `calendar.app.created` scope on the consent screen (README).

### D38. Plan-my-day groundwork (design, M10 part 1; PROVISIONAL – needs owner review)
Built so far: the pure core and the eval. Not yet built: the Claude prompt, the UI and applying
plans to the calendar.
- **Free time** (`src/core/plan/slots.ts`) is the planning window (wall-clock, so DST days come
  out at 23 or 25 hours) minus merged busy time, after "now", in gaps of at least 15 minutes.
  This free time is the only calendar information plan-my-day will ever send to Claude (D18).
- **The greedy planner** (`greedy.ts`) is the fallback with AI off and the eval's baseline:
  earliest deadline first, then priority, each task whole in the earliest gap that fits, the rest
  listed as unscheduled.
- **The validator** (`validate.ts`, a teaching module under D25) defines a valid plan:
  - only real candidate tasks, each at most once;
  - every block at least 15 minutes long, inside the window and not before now;
  - no overlap with busy time or with another block;
  - every block ends by its task's deadline;
  - no block longer than estimate × 1.25 (with a 15-minute floor; see below);
  - every candidate either scheduled or listed as unscheduled.
  The app will refuse any plan it rejects, and the eval counts how often the model's plans
  would have been rejected.
- **The 15-minute floor:** "at least 15 minutes" and "at most estimate × 1.25" conflict for a
  task estimated under 12 minutes. The over-estimate limit is therefore never below 15 minutes.
- **The eval set has 200 seeded days** (frozen 2026-10-07), with both DST days and about 15 %
  overloaded days. The first draft overloaded 106 of 200 days, against the plan's ~15 %. It was
  corrected to 34 of 200 (17 %) before any planner other than the greedy baseline had run, so
  it matches the pre-registered design and isn't tuned to a result.
- **Baseline (greedy):**
  - 0 % raw violations;
  - 99.1 % of due-today tasks scheduled on feasible days;
  - 100 % of overloaded days handled.
  This is a strong baseline. A Claude plan has to beat it on *quality* (priority-weighted
  minutes ≥ 1.00 × greedy) without breaking rules, or plan-my-day ships with the greedy engine,
  as PLAN §5.2 already says.
- **Property test:** over 1,000 random days, the greedy planner never produced a plan the
  validator rejects.

### D39. Plan my day as built (design, M10 part 2; PROVISIONAL – needs owner review)
Your request (2026-10-07): write out tomorrow's to-dos, see them on a view of the day with the
calendar already on it, put them in the gaps, and have that create tasks with times. Your
answers: the output is **tasks plus calendar blocks**, with a **reminder 5 minutes before**.

- **Three steps, one page (Plan):**
  1. a brain dump, one task per line, plus a tick list of tasks already due;
  2. a board: a day timeline with your calendar in grey and the tasks as movable blocks;
  3. a confirm sheet.
  Nothing is written until you confirm (PLAN §4).
- **Lengths:**
  - read from the line ("1h", "45m", "(30m)", "for 20 minutes", "1.5 hours");
  - otherwise the task's estimate, otherwise 30 minutes;
  - never under 15 minutes or over 12 hours.
- **The board** is pure functions over a list of items (`core/plan/board.ts`):
  - everything snaps to a 15-minute grid;
  - "Auto-arrange" runs the greedy planner over the tray only, so blocks you placed by hand
    stay put;
  - the validator runs on every change, problems show in red, and Confirm is disabled until
    they're fixed.
- **Board defaults (PROVISIONAL):**
  - the day runs 07:00–22:00 (editable);
  - a 10-minute break between blocks and around meetings (none, 5, 10 or 15);
  - start times are rounded up to the grid.
  The greedy planner gained these as options. Both default to off, so the frozen eval baseline
  is unchanged (re-run: identical numbers).
- **Accessible without a mouse:**
  - every block is focusable and its label gives its times and any problem;
  - ↑/↓ moves a block, Shift+↑/↓ resizes it, and Delete sends it back to the tray;
  - tray items have a Place button.
  axe passes on the board and the confirm sheet.
- **Apply** (`core/plan/apply.ts`):
  - **re-validation:** the plan is checked again against the calendar *as it is now* and the
    window you chose, and refused if it no longer fits;
  - **tasks:** new lines become tasks; ticked tasks are rescheduled, keeping their own
    reminders and adding the 5-minute one (at most 5 reminders);
  - **the batch:** every apply is recorded as a batch (SQLite migration 7, or localStorage in
    the web build). It's saved, *including the ids of the calendar blocks it's about to
    write*, before any block is written. A half-failed write can therefore still be undone.
    A test covers this case, and it caught the original order.
  - **missing tasks:** every task to reschedule is checked to still exist before anything is
    created.
- **Undo** reverses the latest batch exactly:
  - created tasks are deleted;
  - rescheduled tasks get their old date, estimate and reminders back;
  - blocks are removed.
  It's idempotent.
- **Calendar blocks:**
  - **scope:** written with `calendar.events.owned`, asked for only when you first tick "add
    blocks" (incremental consent, like D37). It covers calendars you own only; the picker
    lists those, primary first, and never the app's reminders calendar.
  - **ids:** each block's event id derives from the batch and item (`mmplan` +
    sha256 hex), so a retry can't duplicate one.
  - **the events themselves:** opaque (they count as busy), with no Google alert, because the
    task's reminder does that job.
  - **no duplicates on Today:** synced back, a block carries `extendedProperties.mmBatch`, so
    Today hides it when its task is already on the timeline.
- **Web demo:** the same flow against the generated calendar, tasks only (no Google).
- **Not in this part:** the Claude "arrange with AI" planner and its eval run. These still
  need your key and OK (PLAN §5.2). Until then the greedy arranger is the engine, which is
  what §5.2 prescribes if Claude doesn't beat it.

### D40. The "time bureau" look as built (design, 2026-10-07; PROVISIONAL – needs owner review)
Your ask (2026-10-07): before more features, make the UI feel like the technology at the TVA
in *Loki*, "a very old digital feel". This builds D33.

- **What the show's design is:** production designer Kasra Farahani's TVA imagines that
  "digital technology never existed, and analog technology just kept getting more
  sophisticated":
  - CRT monitors, typewriters and paper;
  - plastic, wood panelling and curved shapes;
  - an orange-and-grey 1950s–60s palette;
  - screen graphics (by Cantina Creative) that are deliberately low-fi, a little pixelated, in a
    limited palette.
- **How the app takes that on**, with original art only:
  - **The console:**
    - a moulded plastic top panel with a three-colour orange stripe;
    - a wood-panelled wall behind it;
    - every page sits on a **CRT screen inside a thick bezel**, with faint scanlines, a phosphor
      glow and a very slow flicker.
  - **Type** (both fonts open-licensed, OFL 1.1, and bundled so the desktop app works offline;
    `font-src 'self'` is unchanged):
    - **VT323**, a CRT-terminal face, for headings, times and stamps;
    - **IBM Plex Mono** for reading text.
  - **Controls:**
    - keycap buttons whose thick lower edge compresses when pressed;
    - nav keys with **indicator lamps** (the current page's lamp is lit);
    - checkboxes as lamps that light up with a tick.
  - **An analog clock** on the console (original SVG, not the show's character), beside an
    amber readout of the time.
  - **Case-file language:**
    - priorities and dates are rubber **stamps**;
    - overdue tasks get a red **"Variance"** stamp;
    - due reminders arrive as an **"Incoming dispatch"**;
    - calendar time on the Plan board is hatched ("spoken for");
    - the Today schedule is a glowing **timeline** with a node at each moment and a blinking
      NOW cursor.
- **Two themes** (PROVISIONAL), switched from the console and remembered per device:
  - **Terminal**, amber phosphor on a dark CRT, is the default;
  - **Office** is brown ink on manila paper with beige plastic hardware.
- **Accessibility:**
  - axe passes on every page in **both** themes (a new demo test);
  - effects sit *behind* text and never lower its contrast;
  - flicker and blinking stop under `prefers-reduced-motion`;
  - glow, scanlines and grain are removed under `prefers-contrast: more`;
  - `forced-colors` gets plain system colours;
  - stamp and dispatch labels are decorative CSS with empty alt text, so screen readers hear
    the real headings unchanged.
- **The app icon:**
  - a 1970s console desk clock: a brown moulded housing, an amber-glow bezel, a cream dial at
    10:10 and the three-colour stripe;
  - the tray uses just the dial, so it reads at 16 px;
  - the sources are `build/icon.svg` and `build/tray.svg`, and `node scripts/make-icons.mjs`
    renders the PNGs and the web favicon with Playwright's Chromium.
- **Not changed:** layout, wording, and every accessible name and test hook. It's a skin over
  the same app.
- **Still open (from D33):** "Miss Minutes" is a Marvel character's name. Decide the public
  name before v1 (M11).

