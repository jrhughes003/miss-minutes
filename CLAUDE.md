# Miss Minutes

Personal organization app: to-dos, reminders and Google Calendar, with optional AI features
powered by the Claude API. It is the third app in a personal suite, alongside **financeflow** and
**nfl-model**, and is presented publicly, so it must be portfolio quality.

It runs two ways from one codebase, the same as financeflow:

- **Desktop** (Electron): data in a local **SQLite** file, real reminders, Google Calendar and
  Google Tasks sync, and AI through the user's own Anthropic API key. This is the primary way the
  user runs the app.
- **Web demo** (`npm run dev` / the hosted build): data in `localStorage`, a generated fake
  calendar and mocked AI responses. It never touches real Google or Anthropic accounts.

**Status:** M0–M3 are done locally (tasks, reminders, the Today view, and an installer).
Read `PROGRESS.md` first: it always says where we are and what comes next. `PLAN.md` holds the
plan and `DECISIONS.md` the reasons (D1, D2, ...).

## About the user

- Intermediate Python. Comfortable with React and TypeScript through financeflow.
- Background in engineering statistics and control: Kalman filters, state-space models, Bayesian
  reasoning. Explain anything beyond that (for example OAuth/PKCE, IPC security, sync
  algorithms) in the docs or the PR, briefly.
- Windows 11, VS Code, PowerShell. CPU only. The `gh` CLI is not installed.
- Works in short sittings. **Update `PROGRESS.md` at the end of every sitting** ("Current
  state", "Next up").
- **The user commits.** Never run `git commit`, `push`, `tag` or `add`. Add an entry to
  "Suggested commits" in PROGRESS.md instead.
- Claude writes all the code (D25 supersedes D21). Modules marked as teaching modules in
  PLAN.md §7 get extra comments, thorough tests and a walkthrough, so the user can explain them
  in an interview.

## Commands

Requires Node 24.

| Command | What it does |
|---|---|
| `npm run dev` | Web build on `http://localhost:5173` (localStorage) |
| `npm run electron:dev` | Desktop app with hot reload; data in `.dev-user-data/`, never `%APPDATA%` |
| `npm run check` | Typecheck + lint + unit tests |
| `npm test` / `npm run coverage` | Vitest unit tests; coverage enforces ≥ 90 % lines and ≥ 85 % branches on `src/core` |
| `npm run test:e2e` | Playwright on the built web app (port 4317), with axe accessibility checks |
| `npm run test:electron` | The real desktop app (and the packaged one, if `release/` exists). Shows one real Windows notification |
| `npm run dist` | Builds `release\Miss Minutes Setup <version>.exe` (electron-builder cache stays in `node_modules/.cache`) |
| `node scripts/make-icons.mjs` | Regenerates `build/*.png` icons |
| `MM_PROPERTY_RUNS=10000 npx vitest run src/core/reminders/engine.test.ts -t property` | The pre-registered reminder reliability check (about 2.5 min) |

Planned (not yet present): `electron:dev:mock` (M5/M6) and `eval:parse` / `eval:plan`
(M6/M10). Live eval runs cost money, so ask first.

Environment variables the app reads:

| Variable | Effect |
|---|---|
| `MISS_MINUTES_USER_DATA` | Puts the whole user-data folder there. Also skips login-item registration. Tests and dev use it |
| `MISS_MINUTES_TICK_MS` | Reminder check interval (default 30000). Tests use 500 |
| `VITE_DEV_SERVER_URL` | Load the renderer from the Vite dev server |

## Conventions

- TypeScript `strict` everywhere, including the Electron main process. esbuild bundles it to
  CJS in `dist-electron/` (D7).
- Pure core logic lives in `src/core/` (time and DST, recurrence, tasks, reminders, Today). It
  has no Electron, DOM or network imports and takes an injected `Clock`. ESLint rejects
  `new Date()` and `Date.now()` there.
- Time: store instants as UTC ISO strings. Store wall-clock intents as a `LocalDate`/`LocalTime`
  string and convert only through `src/core/time.ts`, using the RFC 5545 DST policy.
- Storage: one service (`TaskService`, `ReminderEngine`) runs over two stores (SQLite in
  `electron/db/`, localStorage in `src/storage/`). Both must pass the shared contract suites in
  `src/test/`.
- IPC: every channel is declared in `src/shared/ipc.ts`. A channel without a main-process
  handler is a compile error.
- The renderer never touches the database, tokens or the network. It goes through
  `src/storage/api.ts`.
- SQLite comes from Node's built-in `node:sqlite` (D26). Schema changes are a new numbered
  migration in `electron/db/migrations.ts`. Never edit a released migration.

## Guardrails (do not break these)

- **Security:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload
  exposes a narrow, typed `window.api`. The Anthropic key and Google OAuth tokens are encrypted
  with `safeStorage`, live in the **main process only**, and are never sent to the renderer or
  written to logs.
- **Secrets never go into the repo.** The user's Google OAuth client file lives *outside* the
  repo (`Documents\GitHub\minutes_credentials.json.json`). `.gitignore` also blocks
  `*credentials*.json` and `client_secret*.json`.
- **Tests and dev runs never touch `%APPDATA%` or login items.** Always set
  `MISS_MINUTES_USER_DATA` when launching Electron outside the installed app.
- **AI data minimization:** every Claude request is built through the per-feature allow-list in
  `electron/ai/payload.ts` (from M6). Adding a field means updating the allow-list, its test,
  and the table in PLAN.md §4.
- **No silent writes to Google:** creating, editing or deleting calendar events or Google Tasks
  needs explicit user confirmation in the UI, and every write must be idempotent (client-chosen
  IDs / sync mapping). The AI only *proposes* changes.
- **The app works with AI off.** Every AI feature has a deterministic fallback.
- **Models:** never hardcode model IDs from memory. They live in one config object; check
  Anthropic's docs when changing them. Use structured outputs, not forced `tool_choice`, which
  current Sonnet and Opus models reject.
- **Evals are pre-registered:** never change targets in PLAN.md §5 after seeing results. Report
  misses honestly in the README.
- **Real data never goes into git or tests:** fixtures use generated fake data only.

## Deploying an update to the installed desktop app

When the user says "deploy the update to my installed instance":

1. **Back up the database** (skip if it doesn't exist yet):
   ```powershell
   Copy-Item "$env:APPDATA\Miss Minutes\missminutes.db" "$env:APPDATA\Miss Minutes\missminutes.db.bak" -Force
   ```
   The app also copies the database itself (`missminutes.db.pre-vN.bak`) before any schema
   migration.
2. **Quit Miss Minutes from the tray** (closing the window only hides it).
3. **Build:** `npm run dist`. This produces `release\Miss Minutes Setup <version>.exe`.
4. **Run the installer** to update in place, then confirm the data is present.

**Invariants. Do NOT change these, or the app will open a different, empty data folder:**
- `package.json` → `build.productName` must stay `"Miss Minutes"`.
- `package.json` → `build.appId` must stay `"com.missminutes.app"`.
- Bumping `version` is fine; it changes only the installer file name.

The data lives in `%APPDATA%\Miss Minutes\missminutes.db`, outside the install folder.
