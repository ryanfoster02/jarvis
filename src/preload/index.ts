import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  Channels,
  Events,
  type AppInfo,
  type ChatResult,
  type ConversationSummary,
  type HistoryResult,
  type Memory,
  type MemoryExportResult,
  type MemoryScope,
  type NewMessage,
  type StoredMessage,
  type CredentialResult,
  type CredentialStatus,
  type MicAccess,
  type ProviderId,
  type TtsResult,
  type VoiceConnectResult,
  type KillSwitchState,
  type Settings,
  type ActionNote,
  type ApprovalRequest,
  type GitHubRepoCheck,
  type ToolInvokeResult,
  type ToolRun,
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
    /** conversationId null = start a new conversation (main returns its id). */
    send: (conversationId: string | null, message: string): Promise<ChatResult> =>
      ipcRenderer.invoke(Channels.chatSend, conversationId, message),
  },
  conversations: {
    list: (): Promise<HistoryResult<ConversationSummary[]>> => ipcRenderer.invoke(Channels.conversationsList),
    messages: (id: string): Promise<HistoryResult<StoredMessage[]>> => ipcRenderer.invoke(Channels.conversationsMessages, id),
    append: (conversationId: string | null, message: NewMessage): Promise<HistoryResult<StoredMessage>> =>
      ipcRenderer.invoke(Channels.conversationsAppend, conversationId, message),
    delete: (id: string): Promise<HistoryResult<boolean>> => ipcRenderer.invoke(Channels.conversationsDelete, id),
  },
  memory: {
    list: (): Promise<HistoryResult<Memory[]>> => ipcRenderer.invoke(Channels.memoryList),
    add: (input: { scope: MemoryScope; text: string }, fromConversation = false): Promise<HistoryResult<Memory>> =>
      ipcRenderer.invoke(Channels.memoryAdd, input, fromConversation),
    update: (id: string, text: string): Promise<HistoryResult<Memory>> => ipcRenderer.invoke(Channels.memoryUpdate, id, text),
    delete: (id: string): Promise<HistoryResult<boolean>> => ipcRenderer.invoke(Channels.memoryDelete, id),
    export: (): Promise<MemoryExportResult> => ipcRenderer.invoke(Channels.memoryExport),
  },
  // Keys go in, never come out: only status (configured, last 4 characters, verified time) is readable.
  credentials: {
    status: (): Promise<CredentialStatus> => ipcRenderer.invoke(Channels.credentialsStatus),
    set: (provider: ProviderId, key: string): Promise<CredentialResult> =>
      ipcRenderer.invoke(Channels.credentialsSet, provider, key),
    clear: (provider: ProviderId): Promise<CredentialStatus> => ipcRenderer.invoke(Channels.credentialsClear, provider),
  },
  voice: {
    micAccess: (): Promise<MicAccess> => ipcRenderer.invoke(Channels.voiceMicAccess),
    connect: (offerSdp: string): Promise<VoiceConnectResult> => ipcRenderer.invoke(Channels.voiceConnect, offerSdp),
  },
  tts: {
    speak: (text: string): Promise<TtsResult> => ipcRenderer.invoke(Channels.ttsSpeak, text),
  },
  // Approvals: the renderer can see what is waiting and answer it; main decides everything else.
  approvals: {
    list: (): Promise<ApprovalRequest[]> => ipcRenderer.invoke(Channels.approvalsList),
    decide: (id: string, approve: boolean): Promise<boolean> => ipcRenderer.invoke(Channels.approvalsDecide, id, approve),
    onChange: (cb: (list: ApprovalRequest[]) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, list: ApprovalRequest[]): void => cb(list)
      ipcRenderer.on(Events.approvalsChanged, listener)
      return () => ipcRenderer.removeListener(Events.approvalsChanged, listener)
    },
  },
  github: {
    /** Ask main to check (with the stored token) that a repository is readable, before allowing it. */
    checkRepo: (repo: string): Promise<GitHubRepoCheck> => ipcRenderer.invoke(Channels.githubCheckRepo, repo),
  },
  tools: {
    /** Action log for the active workspace. */
    runs: (): Promise<HistoryResult<ToolRun[]>> => ipcRenderer.invoke(Channels.toolRunsList),
    /** Relay a voice-session tool call (name + JSON arguments) to main, which checks and runs it. */
    invoke: (name: string, args: string): Promise<ToolInvokeResult> => ipcRenderer.invoke(Channels.toolsInvoke, name, args),
    /** Fires after every logged action, whatever started it. */
    onLogged: (cb: (note: ActionNote) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, note: ActionNote): void => cb(note)
      ipcRenderer.on(Events.toolRunLogged, listener)
      return () => ipcRenderer.removeListener(Events.toolRunLogged, listener)
    },
  },
} as const

export type JarvisApi = typeof api

contextBridge.exposeInMainWorld('jarvis', api)
