# Miss Minutes

To-dos, reliable reminders and Google Calendar in one desktop app, with optional
Claude-powered capture and planning. **Work in progress.** See [PLAN.md](PLAN.md) for the
plan and [PROGRESS.md](PROGRESS.md) for where things stand.

**Live demo:** published by the "Deploy demo" workflow to this repository's GitHub Pages site.
It uses sample tasks and a generated calendar, never touches a real account, and keeps
everything you add in your own browser. [Privacy](public/privacy.html).

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
npm run test:demo      # the hosted demo build (sample data, generated calendar)
npm run test:electron  # the real desktop app
npm run dist           # build the Windows installer into release/
```

## Publishing the demo (one-time setup)

1. Push the repository to GitHub.
2. In the repository, go to **Settings → Pages → Build and deployment** and set **Source** to
   **GitHub Actions**.
3. Every push to `main` then runs `.github/workflows/pages.yml`, which builds the demo
   (`npm run build:demo`) and publishes it. The site address appears in the workflow run and
   in Settings → Pages.

The privacy page is served at `<site>/privacy.html`. Use it as the privacy-policy link on the
Google OAuth consent screen, with the site root as the homepage.

## Connecting Google Calendar (desktop app)

Miss Minutes connects with **your own** Google Cloud OAuth client, so no third party ever holds
access to your calendar.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the
   **Google Calendar API**.
2. Set up the **OAuth consent screen**:
   - User type **External**.
   - Add the scopes `calendar.calendarlist.readonly` and `calendar.events.readonly`.
   - While the app is in **Testing**, add yourself as a test user. In Testing, Google sign-ins
     expire after 7 days. To avoid that, publish the app ("In production"); Google then shows a
     one-time "unverified app" warning when you sign in.
3. Create credentials → **OAuth client ID** → application type **Desktop app**, and download the
   JSON file. Keep it outside this repository.
4. In Miss Minutes, go to **Settings → Google Calendar → Import client file…** and pick that JSON
   file. Then click **Connect Google Calendar** and sign in in your browser.

Disconnecting (in Settings) revokes access at Google and deletes the calendar data Miss Minutes
had stored.

The full README, including how the project was built, arrives at milestone M11.
