// Gmail drafts (Sprint 20). Pure: input validation, RFC 2822 message building, response parsing.
//
// Checked 2026-11-11 (developers.google.com/workspace/gmail):
//  - Create: POST https://gmail.googleapis.com/gmail/v1/users/me/drafts with a Draft { message: { raw } },
//    raw = base64url RFC 2822. Scopes accepted: mail.google.com, gmail.modify, gmail.compose.
//  - No scope allows drafts without also allowing sending; gmail.compose ("Manage drafts and send
//    emails") is the narrowest and is classified Restricted. JARVIS therefore has no code that sends:
//    the only Gmail request it can make is the one built here, to the drafts endpoint.

import { IpcValidationError } from './ipc.ts'
import { detectSecret } from './memory.ts'

export const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'

export const DRAFT_LIMITS = { recipients: 20, subjectChars: 200, bodyChars: 20_000 } as const

export interface DraftInput {
  to: string[]
  cc: string[]
  subject: string
  body: string
}

// Deliberately plain: a mailbox, no display names, no comments, no line breaks.
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

function addresses(v: unknown, field: string, required: boolean): string[] {
  if (v === null || v === undefined) {
    if (required) throw new IpcValidationError(`${field} needs at least one address`)
    return []
  }
  if (!Array.isArray(v)) throw new IpcValidationError(`${field} must be a list of email addresses`)
  const out = [...new Set(v.map((a) => (typeof a === 'string' ? a.trim().toLowerCase() : '')))]
  if (required && out.length === 0) throw new IpcValidationError(`${field} needs at least one address`)
  for (const a of out) {
    if (!EMAIL.test(a) || a.length > 254) throw new IpcValidationError(`"${String(a).slice(0, 60)}" is not an email address`)
  }
  return out
}

/** Recipients and subject can't carry line breaks (no header injection); secrets never go into an email. */
export function validateDraftInput(input: { to: unknown; cc: unknown; subject: unknown; body: unknown }): DraftInput {
  const to = addresses(input.to, 'to', true)
  const cc = addresses(input.cc, 'cc', false).filter((a) => !to.includes(a))
  if (to.length + cc.length > DRAFT_LIMITS.recipients) throw new IpcValidationError(`at most ${DRAFT_LIMITS.recipients} recipients`)
  if (typeof input.subject !== 'string') throw new IpcValidationError('subject must be text')
  const subject = input.subject.trim()
  if (/[\r\n]/.test(subject)) throw new IpcValidationError('subject must be one line')
  if (subject.length > DRAFT_LIMITS.subjectChars) throw new IpcValidationError(`subject is over ${DRAFT_LIMITS.subjectChars} characters`)
  if (typeof input.body !== 'string' || !input.body.trim()) throw new IpcValidationError('body is empty')
  const body = input.body.replace(/\r\n?/g, '\n').trim()
  if (body.length > DRAFT_LIMITS.bodyChars) throw new IpcValidationError(`body is over ${DRAFT_LIMITS.bodyChars} characters`)
  const secret = detectSecret(`${subject}\n${body}`)
  if (secret) throw new IpcValidationError(`the email looks like it contains ${secret}; drafts must never include secrets`)
  return { to, cc, subject, body }
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export const base64url = (bytes: Uint8Array): string => base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** RFC 2047 encoded-word for non-ASCII header text (split so no encoded word exceeds 75 chars). */
export function encodeHeader(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  const words: string[] = []
  let chunk = ''
  for (const ch of text) {
    if (utf8(chunk + ch).length > 45) {
      words.push(`=?UTF-8?B?${base64(utf8(chunk))}?=`)
      chunk = ''
    }
    chunk += ch
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(utf8(chunk))}?=`)
  return words.join('\r\n ')
}

/** A plain-text RFC 2822 message (UTF-8 body, base64 transfer encoding, CRLF line ends). */
export function buildRawMessage(d: DraftInput): string {
  const body = base64(utf8(d.body.replace(/\n/g, '\r\n')))
    .match(/.{1,76}/g)!
    .join('\r\n')
  const headers = [
    `To: ${d.to.join(', ')}`,
    ...(d.cc.length ? [`Cc: ${d.cc.join(', ')}`] : []),
    `Subject: ${encodeHeader(d.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ]
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`
}

/** The request body for drafts.create. */
export function draftRequestBody(d: DraftInput): { message: { raw: string } } {
  return { message: { raw: base64url(utf8(buildRawMessage(d))) } }
}

export function parseDraftResponse(json: unknown): { draftId: string; messageId: string | null } | null {
  if (!json || typeof json !== 'object') return null
  const r = json as { id?: unknown; message?: { id?: unknown } }
  if (typeof r.id !== 'string' || !r.id) return null
  return { draftId: r.id, messageId: typeof r.message?.id === 'string' ? r.message.id : null }
}

/** Gmail's Drafts folder for the connected account. */
export function gmailDraftsLink(email: string | null): string {
  return `https://mail.google.com/mail/${email ? `?authuser=${encodeURIComponent(email)}` : ''}#drafts`
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** One line for the approval card: who it's for and the subject (the body is shown in full below it). */
export function draftSummary(d: DraftInput): string {
  const who = d.to.length > 2 ? `${d.to.slice(0, 2).join(', ')} +${d.to.length - 2}` : d.to.join(', ')
  return clip(`Gmail draft to ${who}${d.cc.length ? ` (cc ${d.cc.length})` : ''}: "${d.subject || '(no subject)'}" — ${d.body.replace(/\s+/g, ' ')}`, 280)
}
