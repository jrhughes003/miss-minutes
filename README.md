# Miss Minutes

To-dos, reliable reminders and Google Calendar in one desktop app, with optional
Claude-powered capture and planning. **Work in progress.** See [PLAN.md](PLAN.md) for the
plan and [PROGRESS.md](PROGRESS.md) for where things stand.

## Run it

Requires Node 24.

```powershell
npm install
npm run dev            # web build in the browser (data stays in this browser)
npm run electron:dev   # desktop app with hot reload
```

## Checks

```powershell
npm run check          # typecheck + lint + unit tests
npm run test:e2e       # web build in Chromium, with axe accessibility checks
npm run test:electron  # the real desktop app
npm run dist           # build the Windows installer into release/
```

The full README, including how the project was built, arrives at milestone M11.
