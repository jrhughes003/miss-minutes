// The preload bridge: the only code that runs with access to both the page and
// Electron's IPC. It exposes one narrow object, `window.api`, through
// contextBridge, so the page never holds `ipcRenderer` itself.
//
// `invoke` forwards only channels named in the IPC contract. Anything else is
// rejected here, before it reaches the main process, so a compromised page
// can't call arbitrary channels.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { isChannel, PUSH_CHANNELS, type MissMinutesApi, type PushChannel } from '../src/shared/ipc'

const api: MissMinutesApi = {
  isElectron: true,
  invoke(channel, ...args) {
    if (!isChannel(channel)) return Promise.reject(new Error(`Unknown IPC channel: ${String(channel)}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, listener) {
    if (!PUSH_CHANNELS.includes(channel as PushChannel)) throw new Error(`Unknown push channel: ${String(channel)}`)
    // Wrap the listener so the page never receives the raw IpcRendererEvent,
    // which carries a reference back to ipcRenderer.
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
