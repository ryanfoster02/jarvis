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

export interface Settings {
  theme: Theme
  reducedMotion: boolean
  activeWorkspace: WorkspaceId
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  theme: 'cyan',
  reducedMotion: false,
  activeWorkspace: 'personal',
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
