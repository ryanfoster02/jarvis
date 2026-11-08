import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  Channels,
  Events,
  type AppInfo,
  type ChatResult,
  type KillSwitchState,
  type Settings,
} from '../shared/ipc.ts'

// The only surface the renderer can reach. Functions only — ipcRenderer itself is never exposed,
// and each method maps to exactly one allowlisted channel.
const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(Channels.appInfo),
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(Channels.settingsGet),
    update: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(Channels.settingsUpdate, patch),
  },
  killSwitch: {
    get: (): Promise<KillSwitchState> => ipcRenderer.invoke(Channels.killSwitchGet),
    engage: (reason?: string): Promise<KillSwitchState> => ipcRenderer.invoke(Channels.killSwitchEngage, reason),
    rearm: (): Promise<KillSwitchState> => ipcRenderer.invoke(Channels.killSwitchRearm),
    onChange: (cb: (state: KillSwitchState) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, state: KillSwitchState): void => cb(state)
      ipcRenderer.on(Events.killSwitchChanged, listener)
      return () => ipcRenderer.removeListener(Events.killSwitchChanged, listener)
    },
  },
  chat: {
    send: (message: string): Promise<ChatResult> => ipcRenderer.invoke(Channels.chatSend, message),
  },
} as const

export type JarvisApi = typeof api

contextBridge.exposeInMainWorld('jarvis', api)
