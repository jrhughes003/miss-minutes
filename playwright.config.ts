import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the *built* web demo, served by `vite preview`.
// That's the same bundle that goes to GitHub Pages, with the CSP meta tag in
// place, so a policy violation fails here before it reaches visitors.
// A dedicated port: 4173 is Vite's default and is often taken by another
// project's preview server, which Playwright would otherwise test by mistake.
const PORT = 4317

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // A fixed zone and locale make dates in assertions deterministic.
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
