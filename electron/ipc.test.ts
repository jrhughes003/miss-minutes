import { describe, expect, it } from 'vitest'
import { FakeClock } from '../src/core/clock'
import { ValidationError } from '../src/core/tasks/normalize'
import { TaskService } from '../src/core/tasks/service'
import { CHANNELS, decodeIpcError, isChannel } from '../src/shared/ipc'
import { LocalTaskRepo, memoryStorage } from '../src/storage/localRepo'
import { isTrustedSender, registerIpcHandlers, type Handlers, type IpcMainLike, type SenderInfo } from './ipc'
import { makeTaskHandlers } from './taskHandlers'

type Listener = (event: SenderInfo, ...args: unknown[]) => unknown
const FROM_APP: SenderInfo = { senderFrame: { url: 'file:///C:/app/dist/index.html' } }

function setup() {
  const registered = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }
  const notices: string[] = []
  let n = 0
  const service = new TaskService(new LocalTaskRepo(memoryStorage()), new FakeClock('2026-10-06T14:00:00Z'), () => `id${++n}`)
  const handlers: Handlers = {
    'app:info': () => ({ name: 'Miss Minutes', version: '0.0.0', platform: 'test', storage: 'sqlite', timeZone: 'UTC' }),
    ...makeTaskHandlers(service, (e) => notices.push(e.scope)),
    'reminders:active': () => [],
    'reminders:act': () => undefined,
    'settings:get': () => ({ allDayReminderTime: '09:00', startAtLogin: false }),
    'settings:set': () => ({ allDayReminderTime: '09:00', startAtLogin: false }),
  }
  registerIpcHandlers(ipc, handlers)
  const call = (channel: string, ...args: unknown[]) => Promise.resolve(registered.get(channel)!(FROM_APP, ...args))
  return { registered, call, notices }
}

describe('IPC contract', () => {
  it('registers a handler for every channel in the contract, and nothing else', () => {
    const { registered } = setup()
    expect([...registered.keys()].sort()).toEqual([...CHANNELS].sort())
  })

  it('answers requests from the packaged page', async () => {
    const { call } = setup()
    expect(await call('app:info')).toMatchObject({ name: 'Miss Minutes' })
  })

  it('refuses requests from any other origin, or with no sender frame', async () => {
    const { registered } = setup()
    const listener = registered.get('app:info')!
    await expect(Promise.resolve().then(() => listener({ senderFrame: { url: 'https://evil.example/' } }))).rejects.toThrow(/untrusted sender/)
    await expect(Promise.resolve().then(() => listener({ senderFrame: null }))).rejects.toThrow(/untrusted/)
  })

  it('carries a validation error’s name and field across the boundary', async () => {
    const { call } = setup()
    const error = await call('tasks:create', { title: '   ' }).catch((e: unknown) => e)
    expect(decodeIpcError(error)).toEqual({ name: 'ValidationError', field: 'title', message: 'Title is required.' })
  })

  it('tells the renderer to refresh after a change, but not after a read', async () => {
    const { call, notices } = setup()
    const task = (await call('tasks:create', { title: 'Hello' })) as { id: string }
    await call('tasks:list', {})
    await call('tasks:complete', task.id)
    await call('projects:create', 'Home')
    expect(notices).toEqual(['tasks', 'tasks', 'projects'])
  })
})

describe('decodeIpcError', () => {
  it('falls back to the plain message for errors that were not encoded', () => {
    expect(decodeIpcError(new Error('plain'))).toEqual({ name: 'Error', message: 'plain' })
    expect(decodeIpcError(new ValidationError('x', 'y'))).toEqual({ name: 'ValidationError', message: 'y' })
  })
})

describe('isTrustedSender', () => {
  it('trusts the dev server only when one is configured', () => {
    expect(isTrustedSender('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(isTrustedSender('http://localhost:5173/', undefined)).toBe(false)
    expect(isTrustedSender('http://localhost:9999/', 'http://localhost:5173')).toBe(false)
  })
})

describe('isChannel', () => {
  it('accepts contract channels and rejects everything else', () => {
    expect(isChannel('tasks:create')).toBe(true)
    expect(isChannel('fs:readFile')).toBe(false)
    expect(isChannel('toString')).toBe(false) // inherited properties don't count
    expect(isChannel(42)).toBe(false)
  })
})
