// Registers the main-process side of the IPC contract (src/shared/ipc.ts).
//
// This module doesn't import Electron. It takes anything shaped like ipcMain,
// so tests can pass a fake and check that every channel is registered and that
// requests from unexpected origins are refused.

import { CHANNELS, encodeIpcError, type ArgsOf, type Channel, type ResultOf } from '../src/shared/ipc'

/** One handler per channel. The mapped type makes a missing handler a compile error. */
export type Handlers = {
  [C in Channel]: (...args: ArgsOf<C>) => ResultOf<C> | Promise<ResultOf<C>>
}

/** The parts of an IPC event we use: who sent it. */
export interface SenderInfo {
  senderFrame?: { url: string } | null
}

/** The subset of Electron's ipcMain that we need. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: SenderInfo, ...args: unknown[]) => unknown): void
}

/**
 * Only our own page may call the main process. In development that's the Vite
 * dev server; when packaged it's the bundled file:// page. Anything else, such
 * as a page the window was somehow navigated to, gets an error.
 */
export function isTrustedSender(url: string | undefined, devServerUrl: string | undefined): boolean {
  if (!url) return false
  if (devServerUrl && url.startsWith(devServerUrl)) return true
  return url.startsWith('file://')
}

export function registerIpcHandlers(
  ipcMain: IpcMainLike,
  handlers: Handlers,
  options: { devServerUrl?: string | undefined } = {},
): void {
  for (const channel of CHANNELS) {
    const handler = handlers[channel] as (...args: unknown[]) => unknown
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event.senderFrame?.url, options.devServerUrl)) {
        throw new Error(encodeIpcError(new Error(`IPC ${channel} refused: untrusted sender`)))
      }
      try {
        return await handler(...args)
      } catch (e) {
        // Re-thrown with name and field encoded, so the renderer can show the
        // right message next to the right input (see decodeIpcError).
        throw new Error(encodeIpcError(e), { cause: e })
      }
    })
  }
}
