// IPC contract shared by main, preload and renderer.
// Pure TypeScript only (no Electron/Node imports) so it can be unit-tested with node:test.
// Adding a channel: add it here + validator + test, handler in main/ipc.ts, method in preload.

export const Channels = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  killSwitchGet: 'killswitch:get',
  killSwitchEngage: 'killswitch:engage',
  killSwitchRearm: 'killswitch:rearm',
  chatSend: 'chat:send',
  credentialsStatus: 'credentials:status',
  credentialsSet: 'credentials:set',
  credentialsClear: 'credentials:clear',
  ttsSpeak: 'tts:speak',
  conversationsList: 'conversations:list',
  conversationsMessages: 'conversations:messages',
  conversationsAppend: 'conversations:append',
  conversationsDelete: 'conversations:delete',
  memoryList: 'memory:list',
  memoryAdd: 'memory:add',
  memoryUpdate: 'memory:update',
  memoryDelete: 'memory:delete',
  memoryExport: 'memory:export',
  voiceMicAccess: 'voice:mic-access',
  voiceConnect: 'voice:connect',
  approvalsList: 'approvals:list',
  approvalsDecide: 'approvals:decide',
  toolRunsList: 'tools:runs',
  toolsInvoke: 'tools:invoke',
  githubCheckRepo: 'github:check-repo',
  remindersList: 'reminders:list',
  remindersAdd: 'reminders:add',
  remindersCancel: 'reminders:cancel',
  remindersDismiss: 'reminders:dismiss',
  remindersSnooze: 'reminders:snooze',
  backgroundStatus: 'background:status',
  tasksList: 'tasks:list',
  tasksCancel: 'tasks:cancel',
  tasksCancelAction: 'tasks:cancel-action',
  workflowsList: 'workflows:list',
  workflowsSave: 'workflows:save',
  workflowsDelete: 'workflows:delete',
  workflowsRun: 'workflows:run',
  workflowsRuns: 'workflows:runs',
  leadsList: 'leads:list',
  leadsSave: 'leads:save',
  leadsDelete: 'leads:delete',
  webhooksList: 'webhooks:list',
  webhooksAdd: 'webhooks:add',
  webhooksDelete: 'webhooks:delete',
  webhooksTest: 'webhooks:test',
} as const

/** Main → renderer push events. */
export const Events = {
  killSwitchChanged: 'killswitch:changed',
  approvalsChanged: 'approvals:changed',
  /** An action was logged (carries its ActionNote). */
  toolRunLogged: 'tools:run-logged',
  /** Reminders changed (added, fired, cancelled…): reload the list. */
  remindersChanged: 'reminders:changed',
  /** A reminder just fired (carries the Reminder). */
  reminderFired: 'reminders:fired',
  /** Running tasks changed (carries RunningTask[]). */
  tasksChanged: 'tasks:changed',
  /** Workflows or their runs changed: reload. */
  workflowsChanged: 'workflows:changed',
  /** A workflow run finished (carries WorkflowRunNotice). */
  workflowFinished: 'workflows:finished',
  /** Leads changed (by Jarvis or another window): reload. */
  leadsChanged: 'leads:changed',
} as const

export type Channel = (typeof Channels)[keyof typeof Channels]

// ---------- Types ----------

export const THEMES = ['gold', 'azure', 'cyan'] as const
export type Theme = (typeof THEMES)[number]

/** Workspaces separate context. Phase 2 moves these to SQLite and scopes memory by workspace. */
export const WORKSPACES = [
  { id: 'personal', name: 'Personal' },
  { id: 'foster-automation', name: 'Foster Automation' },
  { id: 'client-projects', name: 'Client projects' },
  { id: 'development', name: 'Development' },
  { id: 'research', name: 'Research' },
] as const
export type WorkspaceId = (typeof WORKSPACES)[number]['id']

/** Realtime voice models (verified against OpenAI docs 2026-11-08; gpt-realtime-mini is deprecated). */
export const REALTIME_MODELS = [
  { id: 'gpt-realtime-2.1-mini', name: 'GPT Realtime 2.1 mini (lower cost)' },
  { id: 'gpt-realtime-2.1', name: 'GPT Realtime 2.1' },
] as const
export type RealtimeModelId = (typeof REALTIME_MODELS)[number]['id']

/** Built-in Realtime voices. OpenAI recommends marin and cedar for quality. */
export const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const
export type VoiceId = (typeof VOICES)[number]

/** How Jarvis speaks. The accent comes from instructions; Ballad is the closest built-in voice to British English. */
export const PERSONAS = [
  { id: 'british-butler', name: 'British butler (JARVIS style)' },
  { id: 'neutral', name: 'Neutral assistant' },
] as const
export type PersonaId = (typeof PERSONAS)[number]['id']

export const HONORIFICS = [
  { id: 'none', name: 'No title' },
  { id: 'sir', name: 'Sir' },
  { id: 'maam', name: "Ma'am" },
] as const
export type HonorificId = (typeof HONORIFICS)[number]['id']

/** One-click preset for the JARVIS feel (voice + persona; leaves form of address to the owner). */
export const JARVIS_PRESET = { voice: 'ballad', persona: 'british-butler' } as const satisfies Partial<Settings>

/** ElevenLabs JARVIS-style preset: British baritone + butler persona. */
export const ELEVEN_PRESET = {
  speechEngine: 'elevenlabs',
  elevenVoiceId: '6WwXjDDEMyNmFG95zycZ',
  persona: 'british-butler',
} as const satisfies Partial<Settings>

/** Who speaks Jarvis's replies. ElevenLabs gives real British voices; OpenAI is the built-in fallback. */
export const SPEECH_ENGINES = [
  { id: 'elevenlabs', name: 'ElevenLabs (British voices)' },
  { id: 'openai', name: 'OpenAI built-in voices' },
] as const
export type SpeechEngineId = (typeof SPEECH_ENGINES)[number]['id']

/**
 * British male ElevenLabs voices (IDs from elevenlabs.io docs, checked 2026-11-08).
 * ElevenLabs' legacy Default voices (George, Daniel) expire 2026-12-31 and only work on accounts
 * created before March 2026; Eldrin and Finley are ElevenLabs' named replacements (Voice Library).
 */
export const ELEVEN_VOICES = [
  { id: '6WwXjDDEMyNmFG95zycZ', name: 'Eldrin', note: 'Crisp British baritone (replaces George)' },
  { id: 'fnYMz3F5gMEDGMWcH1ex', name: 'Finley', note: 'Articulate British anchor (replaces Daniel)' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', note: 'Warm, refined British (legacy, ends Dec 31 2026)' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', note: 'Authoritative British newsreader (legacy, ends Dec 31 2026)' },
] as const

export const ELEVEN_MODELS = [
  { id: 'eleven_flash_v2_5', name: 'Flash v2.5 (fast, lower cost)' },
  { id: 'eleven_v4_turbo', name: 'v4 Turbo (fast, newest)' },
] as const
export type ElevenModelId = (typeof ELEVEN_MODELS)[number]['id']

/** Models for typed replies (Responses API). Checked against OpenAI docs 2026-11-09. */
/** Who answers typed messages. Voice always uses OpenAI Realtime (Anthropic has no speech-to-speech API). */
export const TEXT_PROVIDERS = ['openai', 'anthropic'] as const
export type TextProviderId = (typeof TEXT_PROVIDERS)[number]
export const TEXT_PROVIDER_NAMES: Record<TextProviderId, string> = { openai: 'OpenAI', anthropic: 'Anthropic Claude' }

/** Models for typed replies. Checked against OpenAI and Anthropic docs 2026-11-09. */
export const TEXT_MODELS = [
  { id: 'gpt-5.4-mini', provider: 'openai', name: 'GPT-5.4 mini (fast)' },
  { id: 'gpt-5-mini', provider: 'openai', name: 'GPT-5 mini (lower cost)' },
  { id: 'claude-haiku-5-5', provider: 'anthropic', name: 'Claude Haiku 5.5 (fastest, lowest cost)' },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', name: 'Claude Sonnet 5.5 (stronger)' },
  { id: 'claude-opus-5-5', provider: 'anthropic', name: 'Claude Opus 5.5 (most capable)' },
] as const
export type TextModelId = (typeof TEXT_MODELS)[number]['id']

export function textModelProvider(id: TextModelId): TextProviderId {
  return TEXT_MODELS.find((m) => m.id === id)?.provider ?? 'openai'
}

export interface Settings {
  theme: Theme
  reducedMotion: boolean
  activeWorkspace: WorkspaceId
  voice: VoiceId
  realtimeModel: RealtimeModelId
  persona: PersonaId
  honorific: HonorificId
  speechEngine: SpeechEngineId
  /** ElevenLabs voice ID: one of ELEVEN_VOICES or any voice ID from the owner's ElevenLabs account. */
  elevenVoiceId: string
  elevenModel: ElevenModelId
  /** Let the owner talk over Jarvis while it speaks through ElevenLabs. Off = mic pauses during speech (avoids echo on speakers). */
  bargeIn: boolean
  /** Model for typed replies when voice is off. */
  textModel: TextModelId
  /** Read typed replies aloud with the ElevenLabs voice (when that engine and key are set up). */
  speakTypedReplies: boolean
  /** Permissions (SECURITY.md §4): tools the owner has switched off. Off = Jarvis is never offered them. */
  disabledTools: ToolName[]
  /** Mandate: save memories Jarvis proposes without asking each time. Off by default. */
  autoSaveMemories: boolean
  /** Scope (SECURITY.md §4): GitHub repositories Jarvis may read, as "owner/name" (lowercase). Empty = none. */
  githubRepos: string[]
  /** Mandate: let Jarvis set reminders without asking each time. Off by default. Cancelling always asks. */
  autoSetReminders: boolean
  /** Show macOS notifications when reminders fire (the in-app alert always shows). */
  reminderNotifications: boolean
  /** Keep running in the menu bar when the window is closed, so reminders still fire. Off by default. */
  runInBackground: boolean
  /** Start JARVIS (in the menu bar) when you log in. Installed app only; requires runInBackground. */
  openAtLogin: boolean
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  theme: 'gold',
  reducedMotion: false,
  activeWorkspace: 'personal',
  voice: 'ballad',
  realtimeModel: 'gpt-realtime-2.1-mini',
  persona: 'british-butler',
  honorific: 'none',
  speechEngine: 'elevenlabs',
  elevenVoiceId: '6WwXjDDEMyNmFG95zycZ',
  elevenModel: 'eleven_flash_v2_5',
  bargeIn: false,
  textModel: 'gpt-5.4-mini',
  speakTypedReplies: true,
  disabledTools: [],
  autoSaveMemories: false,
  githubRepos: [],
  autoSetReminders: false,
  reminderNotifications: true,
  runInBackground: false,
  openAtLogin: false,
})

/** Execution limits (SECURITY.md §6). Enforced per typed request by RunBudget (Sprint 8). */
export interface ExecutionLimits {
  maxIterations: number
  maxSeconds: number
  maxToolCalls: number
  maxCostUsd: number
  maxSubagentDepth: number
  maxConcurrentAgents: number
  /** Helper agents running at once, app-wide (Sprint 12). */
  maxConcurrentHelpers: number
}

export const DEFAULT_LIMITS: ExecutionLimits = Object.freeze({
  maxIterations: 10,
  maxSeconds: 120,
  maxToolCalls: 20,
  maxCostUsd: 1,
  maxSubagentDepth: 1,
  maxConcurrentAgents: 2,
  maxConcurrentHelpers: 2,
})

/** Each helper agent's own budget (its spend also counts against the request that started it). */
export const HELPER_LIMITS: ExecutionLimits = Object.freeze({
  maxIterations: 6,
  maxSeconds: 90,
  maxToolCalls: 8,
  maxCostUsd: 0.25,
  maxSubagentDepth: 0, // helpers can't start helpers
  maxConcurrentAgents: 1,
  maxConcurrentHelpers: 0,
})

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  versions: { electron: string; chrome: string; node: string }
  isPackaged: boolean
}

export interface KillSwitchState {
  engaged: boolean
  engagedAt: string | null
  reason: string | null
}

export const PROVIDERS = ['openai', 'anthropic', 'elevenlabs', 'github'] as const
export type ProviderId = (typeof PROVIDERS)[number]
export const PROVIDER_ENV: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  github: 'GITHUB_TOKEN',
}

export interface ProviderKeyStatus {
  configured: boolean
  /** Where the key in use comes from. In development a .env key overrides the saved one. */
  source: 'env' | 'vault' | null
  last4: string | null
  verifiedAt: string | null
  /** A key is also saved in the vault but is currently overridden by .env. */
  vaultOverridden: boolean
  /** Problem with the .env entry (bad format etc.), shown in Settings. Never contains the key. */
  envError: string | null
}

export interface CredentialStatus {
  /** False if the OS can't encrypt secrets (then keys can't be saved). */
  encryptionAvailable: boolean
  openai: ProviderKeyStatus
  anthropic: ProviderKeyStatus
  elevenlabs: ProviderKeyStatus
  github: ProviderKeyStatus
}

export type CredentialResult = { ok: true; status: CredentialStatus } | { ok: false; message: string }

export type MicAccess = 'granted' | 'denied' | 'restricted' | 'unknown'

export type VoiceConnectResult =
  | {
      ok: true
      answerSdp: string
      model: RealtimeModelId
      speechEngine: SpeechEngineId
      transcription: boolean
      bargeIn: boolean
    }
  | {
      ok: false
      code: 'no_key' | 'no_tts_key' | 'halted' | 'invalid_key' | 'network' | 'api_error' | 'invalid_input'
      message: string
    }

export type TtsResult =
  | { ok: true; audio: Uint8Array; characters: number }
  | { ok: false; code: 'no_key' | 'halted' | 'invalid_input' | 'network' | 'api_error'; message: string }

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface TextUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface StoredMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  text: string
  via: 'text' | 'voice'
  createdAt: number
}

export type MemoryScope = 'global' | 'workspace'

/** A fact Jarvis should know. 'global' applies in every workspace; 'workspace' only in its own. */
export interface Memory {
  id: string
  scope: MemoryScope
  workspaceId: string | null
  text: string
  source: 'user' | 'conversation'
  createdAt: number
  updatedAt: number
}

export type MemoryExportResult = { ok: true; path: string; count: number } | { ok: false; cancelled: boolean; message: string }

/** Errors from history calls. 'unavailable' = database couldn't open; Jarvis still works without history. */
export type HistoryResult<T> = { ok: true; value: T } | { ok: false; code: 'unavailable' | 'not_found' | 'invalid_input'; message: string }

export type ChatResult =
  | {
      ok: true
      reply: string
      model: TextModelId
      provider: TextProviderId
      usage: TextUsage
      conversationId: string | null
      /** Tools Jarvis used (or tried to) while answering, in order. */
      actions: ActionNote[]
    }
  | {
      ok: false
      code: 'no_provider' | 'halted' | 'invalid_input' | 'rate_limited' | 'network' | 'api_error' | 'cancelled'
      message: string
      /** Actions that ran before the request stopped (cancelled or failed). */
      actions?: ActionNote[]
    }

export const MAX_CHAT_CHARS = 8000
export const MAX_REASON_CHARS = 200

// ---------- Validators (throw on bad input; return a clean copy) ----------

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcValidationError'
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v)
}

export function isWorkspaceId(v: unknown): v is WorkspaceId {
  return typeof v === 'string' && WORKSPACES.some((w) => w.id === v)
}

export function isVoiceId(v: unknown): v is VoiceId {
  return typeof v === 'string' && (VOICES as readonly string[]).includes(v)
}

export function isPersonaId(v: unknown): v is PersonaId {
  return typeof v === 'string' && PERSONAS.some((p) => p.id === v)
}

export function isHonorificId(v: unknown): v is HonorificId {
  return typeof v === 'string' && HONORIFICS.some((h) => h.id === v)
}

export function isSpeechEngineId(v: unknown): v is SpeechEngineId {
  return typeof v === 'string' && SPEECH_ENGINES.some((e) => e.id === v)
}

export function isElevenModelId(v: unknown): v is ElevenModelId {
  return typeof v === 'string' && ELEVEN_MODELS.some((m) => m.id === v)
}

/** ElevenLabs voice IDs are short alphanumeric strings (e.g. 6WwXjDDEMyNmFG95zycZ). */
export function isElevenVoiceId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9]{16,32}$/.test(v)
}

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v)
}

export function isTextModelId(v: unknown): v is TextModelId {
  return typeof v === 'string' && TEXT_MODELS.some((m) => m.id === v)
}

export function isRealtimeModelId(v: unknown): v is RealtimeModelId {
  return typeof v === 'string' && REALTIME_MODELS.some((m) => m.id === v)
}

/** Accepts only known keys with correct types. Unknown keys are rejected, not ignored. */
export function validateSettingsPatch(input: unknown): Partial<Settings> {
  if (!isPlainObject(input)) throw new IpcValidationError('settings patch must be an object')
  const out: Partial<Settings> = {}
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'theme':
        if (!isTheme(value)) throw new IpcValidationError(`invalid theme: ${String(value)}`)
        out.theme = value
        break
      case 'reducedMotion':
        if (typeof value !== 'boolean') throw new IpcValidationError('reducedMotion must be boolean')
        out.reducedMotion = value
        break
      case 'activeWorkspace':
        if (!isWorkspaceId(value)) throw new IpcValidationError(`invalid workspace: ${String(value)}`)
        out.activeWorkspace = value
        break
      case 'voice':
        if (!isVoiceId(value)) throw new IpcValidationError(`invalid voice: ${String(value)}`)
        out.voice = value
        break
      case 'realtimeModel':
        if (!isRealtimeModelId(value)) throw new IpcValidationError(`invalid realtime model: ${String(value)}`)
        out.realtimeModel = value
        break
      case 'persona':
        if (!isPersonaId(value)) throw new IpcValidationError(`invalid persona: ${String(value)}`)
        out.persona = value
        break
      case 'honorific':
        if (!isHonorificId(value)) throw new IpcValidationError(`invalid form of address: ${String(value)}`)
        out.honorific = value
        break
      case 'speechEngine':
        if (!isSpeechEngineId(value)) throw new IpcValidationError(`invalid speech engine: ${String(value)}`)
        out.speechEngine = value
        break
      case 'elevenVoiceId':
        if (!isElevenVoiceId(value)) throw new IpcValidationError('That ElevenLabs voice ID looks wrong. Copy it from the voice in ElevenLabs.')
        out.elevenVoiceId = value
        break
      case 'elevenModel':
        if (!isElevenModelId(value)) throw new IpcValidationError(`invalid ElevenLabs model: ${String(value)}`)
        out.elevenModel = value
        break
      case 'bargeIn':
        if (typeof value !== 'boolean') throw new IpcValidationError('bargeIn must be boolean')
        out.bargeIn = value
        break
      case 'textModel':
        if (!isTextModelId(value)) throw new IpcValidationError(`invalid text model: ${String(value)}`)
        out.textModel = value
        break
      case 'speakTypedReplies':
        if (typeof value !== 'boolean') throw new IpcValidationError('speakTypedReplies must be boolean')
        out.speakTypedReplies = value
        break
      case 'disabledTools':
        if (!Array.isArray(value) || value.length > TOOL_NAMES.length || !value.every(isToolName)) {
          throw new IpcValidationError('disabledTools must be a list of tool names')
        }
        out.disabledTools = [...new Set(value)]
        break
      case 'autoSaveMemories':
        if (typeof value !== 'boolean') throw new IpcValidationError('autoSaveMemories must be boolean')
        out.autoSaveMemories = value
        break
      case 'autoSetReminders':
      case 'reminderNotifications':
      case 'runInBackground':
      case 'openAtLogin':
        if (typeof value !== 'boolean') throw new IpcValidationError(`${key} must be boolean`)
        out[key] = value
        break
      case 'githubRepos':
        if (!Array.isArray(value) || value.length > MAX_GITHUB_REPOS || !value.every(isRepoName)) {
          throw new IpcValidationError(`githubRepos must be up to ${MAX_GITHUB_REPOS} repositories written as owner/name`)
        }
        out.githubRepos = [...new Set(value.map((r) => r.toLowerCase()))]
        break
      default:
        throw new IpcValidationError(`unknown setting: ${key}`)
    }
  }
  return out
}

/** Merge stored (possibly stale/corrupt) data onto defaults, dropping anything invalid. */
export function normalizeSettings(stored: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS }
  if (!isPlainObject(stored)) return s
  if (isTheme(stored.theme)) s.theme = stored.theme
  if (typeof stored.reducedMotion === 'boolean') s.reducedMotion = stored.reducedMotion
  if (isWorkspaceId(stored.activeWorkspace)) s.activeWorkspace = stored.activeWorkspace
  if (isVoiceId(stored.voice)) s.voice = stored.voice
  if (isRealtimeModelId(stored.realtimeModel)) s.realtimeModel = stored.realtimeModel
  if (isPersonaId(stored.persona)) s.persona = stored.persona
  if (isHonorificId(stored.honorific)) s.honorific = stored.honorific
  if (isSpeechEngineId(stored.speechEngine)) s.speechEngine = stored.speechEngine
  if (isElevenVoiceId(stored.elevenVoiceId)) s.elevenVoiceId = stored.elevenVoiceId
  if (isElevenModelId(stored.elevenModel)) s.elevenModel = stored.elevenModel
  if (typeof stored.bargeIn === 'boolean') s.bargeIn = stored.bargeIn
  if (isTextModelId(stored.textModel)) s.textModel = stored.textModel
  if (typeof stored.speakTypedReplies === 'boolean') s.speakTypedReplies = stored.speakTypedReplies
  if (Array.isArray(stored.disabledTools)) s.disabledTools = [...new Set(stored.disabledTools.filter(isToolName))]
  if (typeof stored.autoSaveMemories === 'boolean') s.autoSaveMemories = stored.autoSaveMemories
  if (typeof stored.autoSetReminders === 'boolean') s.autoSetReminders = stored.autoSetReminders
  if (typeof stored.reminderNotifications === 'boolean') s.reminderNotifications = stored.reminderNotifications
  if (typeof stored.runInBackground === 'boolean') s.runInBackground = stored.runInBackground
  if (typeof stored.openAtLogin === 'boolean') s.openAtLogin = stored.openAtLogin
  if (Array.isArray(stored.githubRepos)) {
    s.githubRepos = [...new Set(stored.githubRepos.filter(isRepoName).map((r) => r.toLowerCase()))].slice(0, MAX_GITHUB_REPOS)
  }
  return s
}

export function validateChatMessage(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('message must be a string')
  const text = input.trim()
  if (text.length === 0) throw new IpcValidationError('message is empty')
  if (text.length > MAX_CHAT_CHARS) throw new IpcValidationError(`message exceeds ${MAX_CHAT_CHARS} characters`)
  return text
}

export const MAX_HISTORY_TURNS = 20
export const MAX_HISTORY_CHARS = 40_000

/** Recent conversation sent with a typed message. Oldest turns are dropped to fit the limits. */
export function validateChatHistory(input: unknown): ChatTurn[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new IpcValidationError('history must be a list')
  const turns: ChatTurn[] = []
  for (const t of input.slice(-MAX_HISTORY_TURNS)) {
    if (!isPlainObject(t)) throw new IpcValidationError('history entries must be objects')
    if (t.role !== 'user' && t.role !== 'assistant') throw new IpcValidationError('history role must be user or assistant')
    if (typeof t.text !== 'string') throw new IpcValidationError('history text must be text')
    const text = t.text.trim().slice(0, MAX_CHAT_CHARS)
    if (text) turns.push({ role: t.role, text })
  }
  let total = turns.reduce((n, t) => n + t.text.length, 0)
  while (total > MAX_HISTORY_CHARS && turns.length > 0) total -= turns.shift()!.text.length
  return turns
}

// ---------- Tools, approvals, action log (Sprint 8; SECURITY.md §3–6) ----------

export const TOOL_NAMES = [
  'get_time',
  'list_memories',
  'save_memory',
  'forget_memory',
  'github_list_repos',
  'github_list_issues',
  'github_get_issue',
  'github_recent_commits',
  'github_read_file',
  'set_reminder',
  'list_reminders',
  'cancel_reminder',
  'delegate',
  'list_leads',
  'add_lead',
  'update_lead',
  'send_webhook',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]
export const isToolName = (v: unknown): v is ToolName => typeof v === 'string' && (TOOL_NAMES as readonly string[]).includes(v)

export const RISK_LEVELS = ['low', 'medium', 'high'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export type ToolSource = 'text' | 'voice'

/**
 * How a tool call was decided: auto (low risk), mandate (standing permission), approved/denied/expired
 * (owner's answer or none within the time limit), blocked (kill switch, switched off, or over a limit).
 */
export type ToolDecision = 'auto' | 'mandate' | 'approved' | 'denied' | 'expired' | 'blocked'
export type ToolOutcome = 'ok' | 'error' | 'skipped'

/** One request waiting for the owner. Summary is human-readable and never contains secrets. */
export interface ApprovalRequest {
  id: string
  tool: ToolName
  title: string
  risk: RiskLevel
  summary: string
  source: ToolSource
  requestedAt: number
  expiresAt: number
}

/** A row in the action log. */
export interface ToolRun {
  id: string
  tool: ToolName
  risk: RiskLevel
  source: ToolSource
  summary: string
  decision: ToolDecision
  outcome: ToolOutcome
  detail: string
  createdAt: number
  durationMs: number
}

/** What the conversation shows about an action. */
export interface ActionNote {
  tool: ToolName
  title: string
  decision: ToolDecision
  outcome: ToolOutcome
  detail: string
}

/** Voice tool call result: `output` goes back to the model; `action` is for the conversation view. */
export type ToolInvokeResult = { ok: true; output: string; action: ActionNote } | { ok: false; message: string }

/**
 * Something Jarvis is working on (SECURITY.md §5 worker/workflow levels). A task is one typed request
 * (workflow) or one voice tool call; `action` is the tool running right now (worker).
 */
export interface RunningTask {
  id: string
  kind: 'typed' | 'voice' | 'workflow'
  title: string
  startedAt: number
  /** Actions running now. Several when helpers or read-only lookups run in parallel. */
  actions: Array<{ id: string; tool: ToolName; title: string; startedAt: number }>
}

/** Max size of a tool's JSON arguments from the model. */
export const MAX_TOOL_ARGS_CHARS = 4000

export function validateToolInvoke(name: unknown, args: unknown): { name: ToolName; args: string } {
  if (!isToolName(name)) throw new IpcValidationError('unknown tool')
  if (typeof args !== 'string' || args.length > MAX_TOOL_ARGS_CHARS) throw new IpcValidationError('tool arguments must be a JSON string')
  return { name, args }
}

// ---------- Reminders (Sprint 10) ----------

/**
 * pending → fired (shown) → dismissed; pending → cancelled; pending → missed (due while JARVIS was
 * closed) → dismissed. Snoozing a fired/missed reminder makes it pending again with a new time.
 */
export const REMINDER_STATUSES = ['pending', 'fired', 'missed', 'dismissed', 'cancelled'] as const
export type ReminderStatus = (typeof REMINDER_STATUSES)[number]

export interface Reminder {
  id: string
  workspaceId: WorkspaceId
  text: string
  dueAt: number
  status: ReminderStatus
  source: 'user' | 'assistant'
  createdAt: number
  firedAt: number | null
}

export type ReminderResult = HistoryResult<Reminder>

/** Background mode as the OS sees it (Sprint 11). */
export interface BackgroundStatus {
  /** Menu-bar mode is on and the icon is showing. */
  trayActive: boolean
  /** Open-at-login can be set here (installed app on macOS/Windows). */
  loginItemSupported: boolean
  /** What the OS reports; null when unsupported. */
  openAtLogin: boolean | null
  /** macOS 13+: 'enabled' | 'requires-approval' | 'not-registered' | 'not-found'; null otherwise. */
  loginItemStatus: string | null
}

// ---------- Workflows (Sprint 13) ----------

/** Weekly schedule in local time. days: 0 = Sunday … 6 = Saturday. */
export interface WorkflowSchedule {
  days: number[]
  time: string // "HH:mm"
}

export interface WorkflowRun {
  id: string
  workflowId: string
  trigger: 'manual' | 'schedule'
  status: 'running' | 'ok' | 'error' | 'cancelled'
  startedAt: number
  finishedAt: number | null
  /** Jarvis's result, or what went wrong. */
  output: string
  actions: number
}

export interface Workflow {
  id: string
  workspaceId: WorkspaceId
  name: string
  instructions: string
  schedule: WorkflowSchedule | null
  enabled: boolean
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
  lastRun: WorkflowRun | null
}

export interface WorkflowInput {
  id?: string
  name: string
  instructions: string
  schedule: WorkflowSchedule | null
  enabled: boolean
}

export interface WorkflowRunNotice {
  run: WorkflowRun
  workflowName: string
  workspaceId: WorkspaceId
}

// ---------- Leads (Sprint 15) ----------

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export interface Lead {
  id: string
  workspaceId: WorkspaceId
  name: string
  company: string
  email: string
  status: LeadStatus
  /** Estimated deal value in whole currency units (no currency conversion). */
  value: number
  notes: string
  nextStep: string
  /** YYYY-MM-DD in local time, or null. */
  nextDate: string | null
  createdAt: number
  updatedAt: number
}

export type LeadInput = Omit<Lead, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'> & { id?: string }

// ---------- Webhooks (Sprint 15) ----------

/** What the UI may know about a webhook: never the full URL or the secret. */
export interface WebhookInfo {
  id: string
  name: string
  /** Host only, e.g. "n8n.example.com" — the path of an n8n URL works like a password. */
  host: string
  hasSecret: boolean
  createdAt: number
  lastSentAt: number | null
}

export interface WebhookInput {
  name: string
  url: string
  /** Sent as the X-JARVIS-Secret header (n8n "Header Auth"); null for none. */
  secret: string | null
}

export type WebhookSendResult = { ok: true; status: number; body: string } | { ok: false; message: string }

// ---------- GitHub (Sprint 9) ----------

export const MAX_GITHUB_REPOS = 30

/** "owner/name" per GitHub's rules (owner: letters, digits, single hyphens; name: letters, digits, . _ -). */
export function isRepoName(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 140) return false
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})$/.exec(v)
  return !!m && m[2] !== '.' && m[2] !== '..'
}

export function validateRepoName(input: unknown): string {
  const v = typeof input === 'string' ? input.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '') : input
  if (!isRepoName(v)) throw new IpcValidationError('Write the repository as owner/name, e.g. octocat/hello-world.')
  return v.toLowerCase()
}

/** What Settings shows for a repository after checking it with GitHub. */
export interface GitHubRepoInfo {
  fullName: string
  private: boolean
  description: string
  defaultBranch: string
  openIssues: number
  pushedAt: string | null
  url: string
}

export type GitHubRepoCheck = { ok: true; repo: GitHubRepoInfo } | { ok: false; message: string }

export function validateApprovalId(input: unknown): string {
  if (typeof input !== 'string' || !UUID.test(input)) throw new IpcValidationError('invalid approval id')
  return input.toLowerCase()
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Conversation IDs are UUIDs generated in main. */
export function validateConversationId(input: unknown): string {
  if (typeof input !== 'string' || !UUID.test(input)) throw new IpcValidationError('invalid conversation id')
  return input.toLowerCase()
}

/** null = start a new conversation. */
export function validateOptionalConversationId(input: unknown): string | null {
  return input === null || input === undefined ? null : validateConversationId(input)
}

export interface NewMessage {
  role: 'user' | 'assistant'
  text: string
  via: 'text' | 'voice'
}

/** A message the renderer asks main to store (voice transcripts). */
export function validateNewMessage(input: unknown): NewMessage {
  if (!isPlainObject(input)) throw new IpcValidationError('message must be an object')
  const { role, text, via } = input
  if (role !== 'user' && role !== 'assistant') throw new IpcValidationError('role must be user or assistant')
  if (via !== 'text' && via !== 'voice') throw new IpcValidationError('via must be text or voice')
  if (typeof text !== 'string') throw new IpcValidationError('text must be text')
  const t = text.trim()
  if (!t) throw new IpcValidationError('message is empty')
  if (t.length > MAX_CHAT_CHARS) throw new IpcValidationError(`message exceeds ${MAX_CHAT_CHARS} characters`)
  for (const k of Object.keys(input)) {
    if (k !== 'role' && k !== 'text' && k !== 'via') throw new IpcValidationError(`unknown field: ${k}`)
  }
  return { role, text: t, via }
}

/** Title for a new conversation from its first message. */
export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 60 ? `${one.slice(0, 57).trimEnd()}…` : one || 'New conversation'
}

export function validateReason(input: unknown): string {
  if (input === undefined || input === null) return 'Manual emergency stop'
  if (typeof input !== 'string') throw new IpcValidationError('reason must be a string')
  const r = input.trim().slice(0, MAX_REASON_CHARS)
  return r.length ? r : 'Manual emergency stop'
}

export const MAX_KEY_CHARS = 512
export const MAX_SDP_CHARS = 64 * 1024

/** OpenAI API keys: sk- prefix, URL-safe characters only. Never echoes the key in errors. */
export function validateOpenAIKey(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('API key must be text')
  const key = input.trim()
  if (key.length > MAX_KEY_CHARS) throw new IpcValidationError('That API key is too long')
  if (key.startsWith('sk-ant-')) {
    throw new IpcValidationError('That is an Anthropic (Claude) key. Paste it into the Anthropic box instead.')
  }
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) {
    throw new IpcValidationError("That doesn't look like an OpenAI API key. Keys start with sk- and contain no spaces.")
  }
  return key
}

/** ElevenLabs API keys: URL-safe characters, no spaces. Never echoes the key in errors. */
export function validateElevenLabsKey(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('API key must be text')
  const key = input.trim()
  if (key.length > MAX_KEY_CHARS) throw new IpcValidationError('That API key is too long')
  if (!/^[A-Za-z0-9_-]{24,}$/.test(key)) {
    throw new IpcValidationError("That doesn't look like an ElevenLabs API key. Copy it from ElevenLabs → Developers → API keys.")
  }
  return key
}

/** Anthropic API keys start with sk-ant-. Never echoes the key in errors. */
export function validateAnthropicKey(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('API key must be text')
  const key = input.trim()
  if (key.length > MAX_KEY_CHARS) throw new IpcValidationError('That API key is too long')
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
    throw new IpcValidationError("That doesn't look like an Anthropic API key. Keys start with sk-ant- and contain no spaces.")
  }
  return key
}

/**
 * GitHub personal access tokens. Fine-grained (github_pat_…) is recommended: it can be limited to
 * chosen repositories and read-only permissions. Classic (ghp_…) is accepted but broader.
 */
export function validateGitHubToken(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('Token must be text')
  const key = input.trim()
  if (key.length > MAX_KEY_CHARS) throw new IpcValidationError('That token is too long')
  if (!/^(github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,})$/.test(key)) {
    throw new IpcValidationError(
      "That doesn't look like a GitHub personal access token. Fine-grained tokens start with github_pat_ (recommended); classic ones with ghp_.",
    )
  }
  return key
}

export function validateProviderKey(provider: ProviderId, input: unknown): string {
  if (provider === 'openai') return validateOpenAIKey(input)
  if (provider === 'anthropic') return validateAnthropicKey(input)
  if (provider === 'github') return validateGitHubToken(input)
  return validateElevenLabsKey(input)
}

export const MAX_TTS_CHARS = 1000

/** One chunk of speech for ElevenLabs. */
export function validateTtsText(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('Speech text must be text')
  const text = input.trim()
  if (!text) throw new IpcValidationError('Nothing to say')
  if (text.length > MAX_TTS_CHARS) throw new IpcValidationError(`Speech chunk exceeds ${MAX_TTS_CHARS} characters`)
  return text
}

/** A WebRTC SDP offer from our own renderer: must be a plausible audio offer. */
export function validateSdpOffer(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('SDP offer must be text')
  if (input.length > MAX_SDP_CHARS) throw new IpcValidationError('SDP offer is too large')
  if (!input.startsWith('v=0') || !/\r?\nm=audio /.test(input)) throw new IpcValidationError('Not an audio SDP offer')
  return input
}

/** Safe display hint for a stored key. */
export const keyLast4 = (key: string): string => key.slice(-4)

// ---------- Sender verification ----------

export interface TrustedOrigins {
  /** e.g. http://localhost:5173 in development; undefined when packaged. */
  devServerUrl?: string
  /** file:// URL of the bundled renderer index.html in production. */
  rendererFileUrl?: string
}

/**
 * True only if an IPC message came from our own renderer: the dev server origin
 * (development) or the exact bundled index.html file (production).
 */
export function isTrustedSenderUrl(senderUrl: string | undefined, trusted: TrustedOrigins): boolean {
  if (!senderUrl) return false
  let url: URL
  try {
    url = new URL(senderUrl)
  } catch {
    return false
  }
  if (trusted.devServerUrl) {
    try {
      if (url.origin === new URL(trusted.devServerUrl).origin && url.origin !== 'null') return true
    } catch {
      /* fall through */
    }
  }
  if (trusted.rendererFileUrl && url.protocol === 'file:') {
    const expected = new URL(trusted.rendererFileUrl)
    return url.pathname === expected.pathname
  }
  return false
}
