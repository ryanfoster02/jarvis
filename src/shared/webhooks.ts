// Outgoing webhooks to n8n / Zapier / Make / CRM automations (Sprint 15). Pure; unit-tested.

import { IpcValidationError, type WebhookInput } from './ipc.ts'
import { detectSecret } from './memory.ts'

export const MAX_WEBHOOKS = 20
export const MAX_MESSAGE_CHARS = 4000
export const MAX_DATA_CHARS = 8000
export const MAX_RESPONSE_CHARS = 2000

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** https anywhere; plain http only to this computer (self-hosted n8n on localhost). No credentials in the URL. */
export function validateWebhookUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2000) throw new IpcValidationError('Paste the webhook URL.')
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    throw new IpcValidationError("That isn't a valid URL.")
  }
  if (u.username || u.password) throw new IpcValidationError("Don't put a username or password in the URL; use the secret field.")
  if (u.protocol === 'http:' && !LOCAL_HOSTS.has(u.hostname)) {
    throw new IpcValidationError('Use https (plain http is only allowed for localhost, e.g. a local n8n).')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new IpcValidationError('Webhook URLs must start with https://')
  u.hash = ''
  return u.toString()
}

export function validateWebhookInput(input: unknown): WebhookInput {
  if (!input || typeof input !== 'object') throw new IpcValidationError('webhook must be an object')
  const o = input as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/.test(name)) {
    throw new IpcValidationError('Name it with letters, numbers, spaces, dots, dashes or underscores (up to 40).')
  }
  let secret: string | null = null
  if (o.secret !== undefined && o.secret !== null && o.secret !== '') {
    if (typeof o.secret !== 'string' || o.secret.length > 200 || /[\r\n]/.test(o.secret)) throw new IpcValidationError('The secret must be one line, up to 200 characters.')
    secret = o.secret
  }
  return { name, url: validateWebhookUrl(o.url), secret }
}

/** Shown in the UI instead of the URL: the path of an n8n webhook URL works like a password. */
export const webhookHost = (url: string): string => new URL(url).host

/** Optional structured data from the model, as a JSON string. Must be an object or array. */
export function parseWebhookData(input: unknown): unknown {
  if (input === null || input === undefined || input === '') return null
  if (typeof input !== 'string' || input.length > MAX_DATA_CHARS) throw new IpcValidationError(`data must be JSON text under ${MAX_DATA_CHARS} characters.`)
  let v: unknown
  try {
    v = JSON.parse(input)
  } catch {
    throw new IpcValidationError('data must be valid JSON.')
  }
  if (!v || typeof v !== 'object') throw new IpcValidationError('data must be a JSON object or array.')
  return v
}

export function validateWebhookMessage(input: unknown, data: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new IpcValidationError('message is required.')
  const message = input.trim()
  if (message.length > MAX_MESSAGE_CHARS) throw new IpcValidationError(`Keep the message under ${MAX_MESSAGE_CHARS} characters.`)
  const secret = detectSecret(`${message} ${data === null ? '' : JSON.stringify(data)}`)
  if (secret) throw new IpcValidationError(`That looks like it contains ${secret}. Jarvis never sends credentials.`)
  return message
}

/** The JSON body every webhook receives. */
export function webhookPayload(o: { webhook: string; message: string; data: unknown; workspace: string; now: number; test?: boolean }): Record<string, unknown> {
  return {
    source: 'jarvis',
    webhook: o.webhook,
    workspace: o.workspace,
    sentAt: new Date(o.now).toISOString(),
    ...(o.test ? { test: true } : {}),
    message: o.message,
    data: o.data,
  }
}

export const clipResponse = (s: string): string => (s.length > MAX_RESPONSE_CHARS ? `${s.slice(0, MAX_RESPONSE_CHARS)}… [truncated]` : s)
