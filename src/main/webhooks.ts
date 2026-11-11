import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebhookInfo, WebhookInput, WebhookSendResult } from '../shared/ipc.ts'
import { clipResponse, MAX_WEBHOOKS, webhookHost } from '../shared/webhooks.ts'
import { withCancel } from './openai.ts'
import { encryptionAvailable } from './vault.ts'

// Outgoing webhooks (Sprint 15). An n8n/Zapier webhook URL's path works like a password, so the URL
// and the optional secret are encrypted with safeStorage (like API keys) in userData/webhooks.json.
// The renderer only ever sees the name and the host. Sending is POST-only, never follows redirects,
// and is only reached through the executor (high risk: the owner approves every send) or the
// owner's own "Test" button.

interface Stored {
  id: string
  name: string
  cipher: string // base64 of safeStorage.encryptString(JSON {url, secret})
  createdAt: number
  lastSentAt: number | null
}

export class WebhookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookError'
  }
}

const file = (): string => join(app.getPath('userData'), 'webhooks.json')

function load(): Stored[] {
  if (!existsSync(file())) return []
  try {
    const v = JSON.parse(readFileSync(file(), 'utf8')) as { version?: number; items?: Stored[] }
    return Array.isArray(v.items) ? v.items : []
  } catch {
    return []
  }
}

function save(items: Stored[]): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: 1, items }), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file())
}

function decrypt(s: Stored): { url: string; secret: string | null } | null {
  if (!encryptionAvailable()) return null
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(s.cipher, 'base64'))) as { url: string; secret: string | null }
  } catch {
    return null
  }
}

const info = (s: Stored): WebhookInfo => {
  const d = decrypt(s)
  return { id: s.id, name: s.name, host: d ? webhookHost(d.url) : '(unreadable)', hasSecret: !!d?.secret, createdAt: s.createdAt, lastSentAt: s.lastSentAt }
}

export const listWebhooks = (): WebhookInfo[] => load().map(info)
export const webhookNames = (): string[] => load().map((s) => s.name)

export function addWebhook(input: WebhookInput): WebhookInfo {
  if (!encryptionAvailable()) throw new WebhookError("Secure storage isn't available on this system, so webhooks can't be saved.")
  const items = load()
  if (items.length >= MAX_WEBHOOKS) throw new WebhookError(`You have ${MAX_WEBHOOKS} webhooks. Remove one first.`)
  if (items.some((s) => s.name.toLowerCase() === input.name.toLowerCase())) throw new WebhookError(`A webhook named "${input.name}" already exists.`)
  const stored: Stored = {
    id: crypto.randomUUID(),
    name: input.name,
    cipher: safeStorage.encryptString(JSON.stringify({ url: input.url, secret: input.secret })).toString('base64'),
    createdAt: Date.now(),
    lastSentAt: null,
  }
  save([...items, stored])
  return info(stored)
}

export function deleteWebhook(id: string): boolean {
  const items = load()
  const next = items.filter((s) => s.id !== id)
  if (next.length === items.length) return false
  save(next)
  return true
}

/** For the executor: the target behind a name (case-insensitive), or null. */
export function findWebhook(name: string): { id: string; name: string; url: string; secret: string | null } | null {
  const s = load().find((x) => x.name.toLowerCase() === name.toLowerCase())
  const d = s ? decrypt(s) : null
  return s && d ? { id: s.id, name: s.name, ...d } : null
}

export function findWebhookById(id: string): { id: string; name: string; url: string; secret: string | null } | null {
  const s = load().find((x) => x.id === id)
  const d = s ? decrypt(s) : null
  return s && d ? { id: s.id, name: s.name, ...d } : null
}

/** POST the payload. 2xx = sent. Redirects are not followed (the body could leak to another host). */
export async function postWebhook(
  target: { id: string; url: string; secret: string | null },
  payload: Record<string, unknown>,
  cancel?: AbortSignal,
): Promise<WebhookSendResult> {
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'JARVIS-desktop',
        ...(target.secret ? { 'X-JARVIS-Secret': target.secret } : {}),
      },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: withCancel(AbortSignal.timeout(15_000), cancel),
    })
    const body = clipResponse(await res.text().catch(() => ''))
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, message: `The webhook redirected (${res.status}); JARVIS doesn't follow redirects for webhooks. Use the final URL.` }
    }
    if (!res.ok) return { ok: false, message: `The webhook answered ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}.` }
    const items = load()
    const s = items.find((x) => x.id === target.id)
    if (s) {
      s.lastSentAt = Date.now()
      save(items)
    }
    return { ok: true, status: res.status, body }
  } catch (err) {
    if (cancel?.aborted) return { ok: false, message: 'Cancelled.' }
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return { ok: false, message: timedOut ? "The webhook didn't answer within 15 seconds." : "Couldn't reach the webhook. Check the URL and that the service is running." }
  }
}
