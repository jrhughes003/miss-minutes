// A local stand-in for the Anthropic Messages API, for development, tests
// and the eval harness: no key, no cost, deterministic.
//
//   npm run ai:mock     (listens on http://127.0.0.1:8787)
//
// It answers POST /v1/messages with a response shaped like the real API's,
// containing a structured-output JSON text block. The "model" behind it is the
// deterministic baseline parser, so the mock exercises the whole Claude
// code path (request building, the SDK's schema parsing, validation, usage
// logging) without pretending to be smarter than it is. The model name in the
// reply says "mock" so it can never be mistaken for real results.

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mockBreakdown } from '../../src/core/breakdown/mock'
import { parseBaseline } from '../../src/core/capture/baseline'

export interface MockAi {
  url: string
  requests: { model: string; system: string; userJson: Record<string, unknown> }[]
  /** Make the next N requests fail with this status (e.g. 429 or 529). */
  failNext(n: number, status: number): void
  close(): Promise<void>
}

export async function startMockAi(port = 0): Promise<MockAi> {
  const requests: MockAi['requests'] = []
  let failures = 0
  let failStatus = 500

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'mock: unknown route' } }))
      return
    }
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      const send = (status: number, payload: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload))
      if (!req.headers['x-api-key']) return send(401, { type: 'error', error: { type: 'authentication_error', message: 'mock: missing x-api-key' } })
      if (failures > 0) {
        failures--
        return send(failStatus, { type: 'error', error: { type: failStatus === 429 ? 'rate_limit_error' : 'api_error', message: 'mock: injected failure' } })
      }
      const request = JSON.parse(body) as { model: string; system?: string; messages: { role: string; content: string }[] }
      const userJson = JSON.parse(request.messages[0]?.content ?? '{}') as Record<string, unknown>
      requests.push({ model: request.model, system: request.system ?? '', userJson })

      const reply = (output: unknown) => {
        const text = JSON.stringify(output)
        send(200, {
          id: `msg_mock_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: `${request.model} (mock)`,
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          // Plausible token counts, so usage logging and cost display have something to show.
          usage: { input_tokens: 600 + Math.ceil(body.length / 4), output_tokens: Math.ceil(text.length / 4), cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        })
      }
      // Breakdown requests carry a task title; capture requests carry typed text.
      if (typeof userJson.title === 'string' && userJson.text === undefined) return reply({ steps: mockBreakdown(userJson.title) })

      const r = parseBaseline(String(userJson.text ?? ''), {
        nowLocal: String(userJson.nowLocal ?? ''),
        zone: String(userJson.zone ?? 'UTC'),
        projectNames: (userJson.projectNames as string[]) ?? [],
        tagNames: (userJson.tagNames as string[]) ?? [],
      })
      const output = {
        kind: r.kind,
        title: r.title,
        due_date: r.due?.date ?? null,
        due_time: r.due?.time ?? null,
        priority: r.priority,
        project_name: r.projectName,
        tags: r.tags,
        recurrence: r.recurrence,
        reminder_minutes_before: r.reminderMinutesBefore,
        question: r.question,
      }
      reply(output)
    })
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    requests,
    failNext(n, status) {
      failures = n
      failStatus = status
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
