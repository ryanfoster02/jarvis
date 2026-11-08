import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { keyLast4, type CredentialStatus } from '../shared/ipc.ts'

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

export function credentialStatus(): CredentialStatus {
  const o = read().openai
  return {
    encryptionAvailable: encryptionAvailable(),
    openai: { configured: !!o, last4: o?.last4 ?? null, verifiedAt: o?.verifiedAt ?? null },
  }
}

/** Store an already-verified key. Throws if the OS can't encrypt. */
export function saveOpenAIKey(key: string): void {
  if (!encryptionAvailable()) throw new Error('Secure storage is not available on this system, so the key was not saved.')
  const ciphertext = safeStorage.encryptString(key).toString('base64')
  write({ ...read(), openai: { ciphertext, last4: keyLast4(key), verifiedAt: new Date().toISOString() } })
}

/** Decrypt the OpenAI key for a single request. Returns null if none is stored or decryption fails. */
export function getOpenAIKey(): string | null {
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
