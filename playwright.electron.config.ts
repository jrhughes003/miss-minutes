import { defineConfig } from '@playwright/test'

// Desktop end-to-end tests. They need `npm run build && npm run build:electron`
// first (the test:electron script does both) and a display, so CI runs them on
// Windows only.
export default defineConfig({
  testDir: './e2e-electron',
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
})
