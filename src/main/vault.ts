import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import {
  IpcValidationError,
  keyLast4,
  PROVIDER_ENV,
  validateProviderKey,
  type CredentialStatus,
  type ProviderId,
  type ProviderKeyStatus,
} from '../shared/ipc.ts'

// Credential vault (SECURITY.md §2). Secrets are encrypted with Electron safeStorage, which on macOS
// uses a key held in the login Keychain. Plaintext keys exist only in main-process memory, briefly,
// when a request needs them. They are never logged, never sent to the renderer, never put in settings.

interface StoredSecret {
  ciphertext: string // base64 of safeStorage.encryptString output
  last4: string
  verifiedAt: string
}
type VaultFile = Partial<Record<ProviderId, StoredSecret>>

const vaultPath = (): string => join(app.getPath('userData'), 'vault.json')

function read(): VaultFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(vaultPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as VaultFile) : {}
  } catch {
    return {}
  }
}

function write(v: VaultFile): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = `${vaultPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(v), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, vaultPath())
}

/**
 * Real encryption only. On Linux without a keyring (GNOME Keyring / KWallet), Electron falls back to
 * "basic_text" — a hard-coded password — which is obfuscation, not protection, so keys are refused.
 */
export function encryptionAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform === 'linux') {
    const backend = safeStorage.getSelectedStorageBackend()
    if (backend === 'basic_text' || backend === 'unknown') return false
  }
  return true
}

// ---------- Development .env fallback ----------
// Development only (ignored in packaged builds). Reads OPENAI_API_KEY / ANTHROPIC_API_KEY / ELEVENLABS_API_KEY / GITHUB_TOKEN from
// <project>/.env on each use, so edits apply without a restart. Values are kept out of process.env
// and never reach the renderer. Never use a VITE_-style prefix for secrets: electron-vite would
// bundle those into the UI.

interface EnvKey {
  key: string | null
  error: string | null
}

function envFilePath(): string | null {
  // Never in packaged builds, and never in automated tests (they must not use your real keys).
  if (app.isPackaged || process.env['JARVIS_USER_DATA']) return null
  for (const dir of [app.getAppPath(), process.cwd()]) {
    const p = join(dir, '.env')
    if (existsSync(p)) return p
  }
  return null
}

function readEnvKey(provider: ProviderId): EnvKey {
  const path = envFilePath()
  if (!path) return { key: null, error: null }
  const name = PROVIDER_ENV[provider]
  try {
    const raw = parseEnv(readFileSync(path, 'utf8'))[name]
    if (!raw || !raw.trim()) return { key: null, error: null }
    return { key: validateProviderKey(provider, raw), error: null }
  } catch (err) {
    return {
      key: null,
      error: err instanceof IpcValidationError ? `${name} in .env: ${err.message}` : "The .env file couldn't be read.",
    }
  }
}

function providerStatus(provider: ProviderId, vault: VaultFile): ProviderKeyStatus {
  const saved = vault[provider]
  const env = readEnvKey(provider)
  if (env.key) {
    return {
      configured: true,
      source: 'env',
      last4: keyLast4(env.key),
      verifiedAt: null,
      vaultOverridden: !!saved,
      envError: null,
    }
  }
  return {
    configured: !!saved,
    source: saved ? 'vault' : null,
    last4: saved?.last4 ?? null,
    verifiedAt: saved?.verifiedAt ?? null,
    vaultOverridden: false,
    envError: env.error,
  }
}

export function credentialStatus(): CredentialStatus {
  const v = read()
  return {
    encryptionAvailable: encryptionAvailable(),
    openai: providerStatus('openai', v),
    anthropic: providerStatus('anthropic', v),
    elevenlabs: providerStatus('elevenlabs', v),
    github: providerStatus('github', v),
  }
}

/** Store an already-verified key. Throws if the OS can't encrypt. */
export function saveKey(provider: ProviderId, key: string): void {
  if (!encryptionAvailable()) throw new Error('Secure storage is not available on this system, so the key was not saved.')
  const ciphertext = safeStorage.encryptString(key).toString('base64')
  write({ ...read(), [provider]: { ciphertext, last4: keyLast4(key), verifiedAt: new Date().toISOString() } })
}

/** The key for a single request: .env (development) first, then the encrypted vault. */
export function getKey(provider: ProviderId): string | null {
  const env = readEnvKey(provider)
  if (env.key) return env.key
  const saved = read()[provider]
  if (!saved || !encryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(saved.ciphertext, 'base64'))
  } catch {
    return null
  }
}

export function clearKey(provider: ProviderId): void {
  const v = read()
  delete v[provider]
  if (Object.keys(v).length === 0) {
    if (existsSync(vaultPath())) rmSync(vaultPath())
  } else {
    write(v)
  }
}
