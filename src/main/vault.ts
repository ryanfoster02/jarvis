import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { IpcValidationError, keyLast4, validateOpenAIKey, type CredentialStatus } from '../shared/ipc.ts'

// Credential vault (SECURITY.md §2). Secrets are encrypted with Electron safeStorage, which on macOS
// uses a key held in the login Keychain. Plaintext keys exist only in main-process memory, briefly,
// when a request needs them. They are never logged, never sent to the renderer, never put in settings.

interface StoredSecret {
  ciphertext: string // base64 of safeStorage.encryptString output
  last4: string
  verifiedAt: string
}
interface VaultFile {
  openai?: StoredSecret
}

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

export const encryptionAvailable = (): boolean => safeStorage.isEncryptionAvailable()

// ---------- Development .env fallback ----------
// Development only (ignored in packaged builds). Reads OPENAI_API_KEY from <project>/.env on each use,
// so edits apply without a restart. The value is kept out of process.env and never reaches the renderer.
// Never use a VITE_/RENDERER_VITE_ prefix for secrets: electron-vite would bundle those into the UI.

interface EnvKey {
  key: string | null
  error: string | null
}

function envFilePath(): string | null {
  if (app.isPackaged) return null
  for (const dir of [app.getAppPath(), process.cwd()]) {
    const p = join(dir, '.env')
    if (existsSync(p)) return p
  }
  return null
}

function readEnvKey(): EnvKey {
  const path = envFilePath()
  if (!path) return { key: null, error: null }
  try {
    const raw = parseEnv(readFileSync(path, 'utf8')).OPENAI_API_KEY
    if (!raw || !raw.trim()) return { key: null, error: null }
    return { key: validateOpenAIKey(raw), error: null }
  } catch (err) {
    return {
      key: null,
      error: err instanceof IpcValidationError ? `OPENAI_API_KEY in .env: ${err.message}` : "The .env file couldn't be read.",
    }
  }
}

export function credentialStatus(): CredentialStatus {
  const o = read().openai
  const env = readEnvKey()
  if (env.key) {
    return {
      encryptionAvailable: encryptionAvailable(),
      openai: {
        configured: true,
        source: 'env',
        last4: keyLast4(env.key),
        verifiedAt: null,
        vaultOverridden: !!o,
        envError: null,
      },
    }
  }
  return {
    encryptionAvailable: encryptionAvailable(),
    openai: {
      configured: !!o,
      source: o ? 'vault' : null,
      last4: o?.last4 ?? null,
      verifiedAt: o?.verifiedAt ?? null,
      vaultOverridden: false,
      envError: env.error,
    },
  }
}

/** Store an already-verified key. Throws if the OS can't encrypt. */
export function saveOpenAIKey(key: string): void {
  if (!encryptionAvailable()) throw new Error('Secure storage is not available on this system, so the key was not saved.')
  const ciphertext = safeStorage.encryptString(key).toString('base64')
  write({ ...read(), openai: { ciphertext, last4: keyLast4(key), verifiedAt: new Date().toISOString() } })
}

/** The OpenAI key for a single request: .env (development) first, then the encrypted vault. */
export function getOpenAIKey(): string | null {
  const env = readEnvKey()
  if (env.key) return env.key
  const o = read().openai
  if (!o || !encryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(o.ciphertext, 'base64'))
  } catch {
    return null
  }
}

export function clearOpenAIKey(): void {
  const v = read()
  delete v.openai
  if (Object.keys(v).length === 0) {
    if (existsSync(vaultPath())) rmSync(vaultPath())
  } else {
    write(v)
  }
}
