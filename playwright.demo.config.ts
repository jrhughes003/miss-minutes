import { defineConfig, devices } from '@playwright/test'

// End-to-end tests for the hosted demo build (VITE_DEMO_MODE=1): the exact
// bundle GitHub Pages serves, with sample data and the generated calendar.
const PORT = 4318

export default defineConfig({
  testDir: './e2e-demo',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build:demo && npx vite preview --outDir dist-demo --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
