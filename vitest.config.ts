import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit tests default to the Node environment: core logic must not need a DOM.
// Component tests opt in with a `// @vitest-environment jsdom` first line.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts', 'eval/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
      exclude: ['**/*.test.*', 'src/test/**', 'src/main.tsx', 'electron/main.ts', 'electron/preload.ts'],
      reporter: ['text-summary', 'html'],
      // PLAN.md §5.5: core logic is held to a higher bar than the rest.
      thresholds: {
        'src/core/**': { lines: 90, branches: 85 },
      },
    },
  },
})
