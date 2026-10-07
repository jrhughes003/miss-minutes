// Adds DOM matchers such as toBeInTheDocument(). They're harmless in
// Node-environment tests, which simply don't use them.
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll } from 'vitest'

// findBy* queries wait up to 1 s by default. Under a full parallel test run on
// a busy machine, a jsdom render can take longer than that, which makes tests
// fail at random. 5 s still fails fast on real bugs.
beforeAll(async () => {
  if (typeof document === 'undefined') return
  const { configure } = await import('@testing-library/react')
  configure({ asyncUtilTimeout: 5000 })
})

// Testing Library unmounts rendered trees automatically only when Vitest
// globals are on. They're off here (explicit imports read better), so clean up
// by hand, but only where a DOM exists.
afterEach(async () => {
  if (typeof document === 'undefined') return
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})
