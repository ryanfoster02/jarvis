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
} as const

/** Main → renderer push events. */
export const Events = {
  killSwitchChanged: 'killswitch:changed',
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
export const TEXT_MODELS = [
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini (fast)' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini (lower cost)' },
] as const
export type TextModelId = (typeof TEXT_MODELS)[number]['id']

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
})

/** Execution limits (SECURITY.md §6). Displayed now; enforced by the agent runtime in Phase 2. */
export interface ExecutionLimits {
  maxIterations: number
  maxSeconds: number
  maxToolCalls: number
  maxCostUsd: number
  maxSubagentDepth: number
  maxConcurrentAgents: number
}

export const DEFAULT_LIMITS: ExecutionLimits = Object.freeze({
  maxIterations: 10,
  maxSeconds: 120,
  maxToolCalls: 20,
  maxCostUsd: 1,
  maxSubagentDepth: 1,
  maxConcurrentAgents: 2,
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

export const PROVIDERS = ['openai', 'elevenlabs'] as const
export type ProviderId = (typeof PROVIDERS)[number]
export const PROVIDER_ENV: Record<ProviderId, string> = { openai: 'OPENAI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY' }

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
  elevenlabs: ProviderKeyStatus
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
  | { ok: true; reply: string; model: TextModelId; usage: TextUsage; conversationId: string | null }
  | {
      ok: false
      code: 'no_provider' | 'halted' | 'invalid_input' | 'rate_limited' | 'network' | 'api_error'
      message: string
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

export function validateProviderKey(provider: ProviderId, input: unknown): string {
  return provider === 'openai' ? validateOpenAIKey(input) : validateElevenLabsKey(input)
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
