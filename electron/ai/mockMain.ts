// `npm run ai:mock`: runs the mock Anthropic API on http://127.0.0.1:8787 until stopped.
import { startMockAi } from './mockServer'

void startMockAi(Number(process.env.MOCK_AI_PORT) || 8787).then((m) => console.log(`Mock Anthropic API on ${m.url} (deterministic baseline behind it; no real model).`))
