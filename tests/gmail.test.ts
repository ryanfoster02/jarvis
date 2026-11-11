import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildRawMessage, draftRequestBody, draftSummary, encodeHeader, gmailDraftsLink, parseDraftResponse, validateDraftInput, DRAFT_LIMITS } from '../src/shared/gmail.ts'
import { buildAuthUrl, CALENDAR_SCOPE, GMAIL_COMPOSE_SCOPE, googleScopes } from '../src/shared/google.ts'
import { parseToolArgs, summarizeToolCall, ToolArgsError, TOOLS, toolInstructions } from '../src/shared/tools.ts'
import { decide, type PermissionContext } from '../src/shared/permissions.ts'
import { IpcValidationError } from '../src/shared/ipc.ts'

const ok = { to: ['Ada@Example.com', 'ada@example.com'], cc: ['ada@example.com', 'bob@example.org'], subject: ' Proposal ', body: 'Hi Ada,\r\nHere it is.\n\nRyan' }

test('draft input: addresses cleaned and de-duplicated, CC drops the To addresses, body normalised', () => {
  assert.deepEqual(validateDraftInput(ok), { to: ['ada@example.com'], cc: ['bob@example.org'], subject: 'Proposal', body: 'Hi Ada,\nHere it is.\n\nRyan' })
  assert.deepEqual(validateDraftInput({ ...ok, cc: null }).cc, [])
})

test('draft input: no header injection, bad addresses, too many, secrets or empty bodies', () => {
  const bad = [
    { ...ok, subject: 'Hi\r\nBcc: spy@evil.com' },
    { ...ok, to: ['ada@example.com\r\nBcc: spy@evil.com'] },
    { ...ok, to: ['Ada <ada@example.com>'] },
    { ...ok, to: [] },
    { ...ok, to: 'ada@example.com' },
    { ...ok, to: Array.from({ length: DRAFT_LIMITS.recipients + 1 }, (_, i) => `p${i}@example.com`) },
    { ...ok, body: 'my key is sk-abcdefghijklmnopqrstuvwx' },
    { ...ok, body: '   ' },
    { ...ok, subject: 'x'.repeat(DRAFT_LIMITS.subjectChars + 1) },
  ]
  for (const b of bad) assert.throws(() => validateDraftInput(b), IpcValidationError, JSON.stringify(b).slice(0, 80))
})

const fromB64url = (s: string): string => Buffer.from(s, 'base64url').toString('utf8')

test('RFC 2822: headers, CRLF, UTF-8 subject and body survive the round trip', () => {
  const d = validateDraftInput({ to: ['ana@example.com'], cc: null, subject: 'Café meeting — ¿mañana?', body: 'Olá Ana,\nSee you at the café ☕\n\nRyan' })
  const raw = buildRawMessage(d)
  assert.match(raw, /^To: ana@example\.com\r\nSubject: =\?UTF-8\?B\?/)
  assert.ok(!/\r\nCc:/.test(raw))
  assert.match(raw, /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n/)
  const [head, body] = raw.split('\r\n\r\n')
  assert.equal(Buffer.from(body!.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Olá Ana,\r\nSee you at the café ☕\r\n\r\nRyan')
  const words = [...head!.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1]!, 'base64').toString('utf8'))
  assert.equal(words.join(''), 'Café meeting — ¿mañana?')
  assert.ok(head!.split('\r\n').every((l) => l.length <= 998))
  assert.equal(encodeHeader('Plain ASCII'), 'Plain ASCII')
  const req = draftRequestBody(d)
  assert.equal(fromB64url(req.message.raw), raw)
  assert.ok(!/[+/=]/.test(req.message.raw), 'base64url without padding')
})

test('response and links', () => {
  assert.deepEqual(parseDraftResponse({ id: 'r-123', message: { id: 'm-1', threadId: 't' } }), { draftId: 'r-123', messageId: 'm-1' })
  assert.equal(parseDraftResponse({}), null)
  assert.equal(gmailDraftsLink('me@gmail.com'), 'https://mail.google.com/mail/?authuser=me%40gmail.com#drafts')
  assert.equal(gmailDraftsLink(null), 'https://mail.google.com/mail/#drafts')
})

test('scopes: Gmail only when switched on; the calendar stays read-only', () => {
  assert.deepEqual(googleScopes(false), ['openid', 'email', CALENDAR_SCOPE])
  assert.deepEqual(googleScopes(true), ['openid', 'email', CALENDAR_SCOPE, GMAIL_COMPOSE_SCOPE])
  const u = new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:1', codeChallenge: 'x', state: 's', scopes: googleScopes(true) }))
  assert.equal(u.searchParams.get('scope'), `openid email ${CALENDAR_SCOPE} ${GMAIL_COMPOSE_SCOPE}`)
})

test('tool: medium risk, always asks (no standing permission), needs the gmail:draft scope', () => {
  const spec = TOOLS.gmail_create_draft
  assert.equal(spec.risk, 'medium')
  const ctx = (o: Partial<PermissionContext> = {}): PermissionContext => ({ halted: false, disabled: [], grantedScopes: ['gmail:draft'], mandates: [], untrusted: false, ...o })
  assert.equal(decide(spec, ctx()).kind, 'ask')
  assert.equal(decide(spec, ctx({ grantedScopes: [] })).kind, 'deny')
  const args = parseToolArgs('gmail_create_draft', JSON.stringify({ to: ['ada@example.com'], cc: null, subject: 'Hi', body: 'Hello Ada' }))
  assert.deepEqual(args, { to: ['ada@example.com'], cc: [], subject: 'Hi', body: 'Hello Ada' })
  assert.throws(() => parseToolArgs('gmail_create_draft', JSON.stringify({ to: ['x'], cc: null, subject: 'Hi', body: 'b' })), ToolArgsError)
  assert.equal(summarizeToolCall('gmail_create_draft', args), 'Gmail draft to ada@example.com: "Hi" — Hello Ada')
  assert.ok(draftSummary({ ...args, body: 'x'.repeat(1000) }).length <= 280)
  assert.ok(toolInstructions([spec]).some((l) => l.includes('never sends')))
  assert.ok(toolInstructions([]).length > 0)
})

test('no code anywhere in JARVIS can send email: the only Gmail endpoint used is drafts.create', () => {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p)
    }
  }
  walk(join(import.meta.dirname, '..', 'src'))
  const gmailUrls = new Set<string>()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/https:\/\/gmail\.googleapis\.com[^'"`\s]*/g)) gmailUrls.add(m[0])
    assert.ok(!/drafts\/send|messages\/send|gmail\.send\b|auth\/gmail\.send/.test(src), `${f} must not reference sending`)
  }
  assert.deepEqual([...gmailUrls], ['https://gmail.googleapis.com/gmail/v1/users/me/drafts'])
})
