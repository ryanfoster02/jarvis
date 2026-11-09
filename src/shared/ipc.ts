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
  credentialsSetOpenAI: 'credentials:set-openai',
  credentialsClearOpenAI: 'credentials:clear-openai',
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

export interface Settings {
  theme: Theme
  reducedMotion: boolean
  activeWorkspace: WorkspaceId
  voice: VoiceId
  realtimeModel: RealtimeModelId
  persona: PersonaId
  honorific: HonorificId
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  theme: 'gold',
  reducedMotion: false,
  activeWorkspace: 'personal',
  voice: 'ballad',
  realtimeModel: 'gpt-realtime-2.1-mini',
  persona: 'british-butler',
  honorific: 'none',
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

export interface CredentialStatus {
  /** False if the OS can't encrypt secrets (then keys can't be saved). */
  encryptionAvailable: boolean
  openai: {
    configured: boolean
    /** Where the key in use comes from. In development a .env key overrides the saved one. */
    source: 'env' | 'vault' | null
    last4: string | null
    verifiedAt: string | null
    /** A key is also saved in the vault but is currently overridden by .env. */
    vaultOverridden: boolean
    /** Problem with the .env file (bad format etc.), shown in Settings. Never contains the key. */
    envError: string | null
  }
}

export type CredentialResult = { ok: true; status: CredentialStatus } | { ok: false; message: string }

export type MicAccess = 'granted' | 'denied' | 'restricted' | 'unknown'

export type VoiceConnectResult =
  | { ok: true; answerSdp: string; model: RealtimeModelId; voice: VoiceId; transcription: boolean }
  | {
      ok: false
      code: 'no_key' | 'halted' | 'invalid_key' | 'network' | 'api_error' | 'invalid_input'
      message: string
    }

export type ChatResult =
  | { ok: true; reply: string }
  | { ok: false; code: 'no_provider' | 'halted' | 'invalid_input'; message: string }

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
  return s
}

export function validateChatMessage(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('message must be a string')
  const text = input.trim()
  if (text.length === 0) throw new IpcValidationError('message is empty')
  if (text.length > MAX_CHAT_CHARS) throw new IpcValidationError(`message exceeds ${MAX_CHAT_CHARS} characters`)
  return text
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
