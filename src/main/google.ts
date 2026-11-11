import { app, safeStorage, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  describeApiError,
  eventsPath,
  GOOGLE_CALENDAR_API,
  GOOGLE_REVOKE_URL,
  GMAIL_COMPOSE_SCOPE,
  googleScopes,
  mergeEvents,
  parseCalendarList,
  parseEvents,
  type CalendarEvent,
  type CalendarInfo,
  type GoogleClientInput,
  type GoogleStatus,
  type GoogleTokens,
} from '../shared/google.ts'
import { GoogleAuthError, refreshAccessToken, runLoopbackFlow } from './googleOAuth.ts'
import { draftRequestBody, GMAIL_DRAFTS_URL, parseDraftResponse, type DraftInput } from '../shared/gmail.ts'
import { encryptionAvailable } from './vault.ts'

// Google connection (Sprint 19). The OAuth client (ID + secret) and the tokens are encrypted with
// safeStorage in userData/google.json; nothing about them reaches the renderer except the status.
// Read-only calendar scope. Sign-in happens in the owner's own browser, started by the owner.

interface Secrets {
  clientId: string
  clientSecret: string | null
  refreshToken: string | null
  accessToken: string | null
  expiresAt: number
}

interface Stored {
  version: 1
  cipher: string
  email: string | null
  connectedAt: number | null
  needsReconnect: boolean
  /** Owner switched on Gmail drafts (Sprint 20). Missing in files from Sprint 19 = false. */
  wantGmail?: boolean
  /** Scopes Google granted in the current sign-in. */
  scopes?: string[]
}

type Meta = Omit<Stored, 'version' | 'cipher'>

export class GoogleError extends Error {}

const file = (): string => join(app.getPath('userData'), 'google.json')

function load(): Stored | null {
  if (!existsSync(file())) return null
  try {
    const v = JSON.parse(readFileSync(file(), 'utf8')) as Stored
    return v.version === 1 && typeof v.cipher === 'string' ? v : null
  } catch {
    return null
  }
}

function secretsOf(s: Stored | null): Secrets | null {
  if (!s || !encryptionAvailable()) return null
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(s.cipher, 'base64'))) as Secrets
  } catch {
    return null
  }
}

function save(secrets: Secrets, meta: Meta): void {
  if (!encryptionAvailable()) throw new GoogleError('This computer can’t store secrets securely, so Google can’t be connected.')
  mkdirSync(app.getPath('userData'), { recursive: true })
  const stored: Stored = { version: 1, cipher: safeStorage.encryptString(JSON.stringify(secrets)).toString('base64'), ...meta }
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file())
}

let flow: AbortController | null = null

export function googleStatus(): GoogleStatus {
  const s = load()
  const sec = secretsOf(s)
  return {
    encryptionAvailable: encryptionAvailable(),
    clientSaved: !!sec?.clientId,
    clientHint: sec?.clientId ? sec.clientId.split('-')[0] ?? null : null,
    connected: !!sec?.refreshToken,
    email: s?.email ?? null,
    connectedAt: s?.connectedAt ?? null,
    needsReconnect: !!s?.needsReconnect,
    connecting: flow !== null,
    gmailWanted: !!s?.wantGmail,
    gmailGranted: !!sec?.refreshToken && (s?.scopes ?? []).includes(GMAIL_COMPOSE_SCOPE),
  }
}

/** Gmail drafts can be written right now (scope check for the tool). */
export function gmailReady(): boolean {
  const st = googleStatus()
  return st.gmailWanted && st.gmailGranted && !st.needsReconnect
}

const metaOf = (s: Stored | null): Meta => ({
  email: s?.email ?? null,
  connectedAt: s?.connectedAt ?? null,
  needsReconnect: !!s?.needsReconnect,
  wantGmail: !!s?.wantGmail,
  scopes: s?.scopes ?? [],
})

/** Switching Gmail drafts on takes effect at the next Connect (Google grants scopes per sign-in). */
export function setGmailWanted(want: boolean): GoogleStatus {
  const stored = load()
  const sec = secretsOf(stored)
  if (!sec) throw new GoogleError('Save your Google OAuth client first.')
  save(sec, { ...metaOf(stored), wantGmail: want })
  return googleStatus()
}

/** Calendar access is usable right now (scope check for the tools). */
export function calendarConnected(): boolean {
  const st = googleStatus()
  return st.connected && !st.needsReconnect
}

/** Saving a different client disconnects: tokens belong to the client that issued them. */
export function saveGoogleClient(input: GoogleClientInput): GoogleStatus {
  const stored = load()
  const prev = secretsOf(stored)
  const same = prev?.clientId === input.clientId
  save(
    {
      clientId: input.clientId,
      clientSecret: input.clientSecret ?? (same ? prev?.clientSecret ?? null : null),
      refreshToken: same ? prev?.refreshToken ?? null : null,
      accessToken: same ? prev?.accessToken ?? null : null,
      expiresAt: same ? prev?.expiresAt ?? 0 : 0,
    },
    same && stored ? metaOf(stored) : { ...metaOf(null), wantGmail: !!stored?.wantGmail },
  )
  return googleStatus()
}

const nodeFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => fetch(url, init)

/** Opens Google's consent page in the owner's browser and waits for them to finish (up to 5 minutes). */
export async function connectGoogle(): Promise<GoogleStatus> {
  const sec = secretsOf(load())
  if (!sec?.clientId) throw new GoogleError('Save your Google OAuth client ID first.')
  if (flow) throw new GoogleError('A Google sign-in is already open in your browser.')
  const wantGmail = !!load()?.wantGmail
  flow = new AbortController()
  try {
    const t = await runLoopbackFlow({
      scopes: googleScopes(wantGmail),
      clientId: sec.clientId,
      clientSecret: sec.clientSecret,
      openUrl: (url) => shell.openExternal(url),
      fetchFn: nodeFetch,
      signal: flow.signal,
    })
    save(
      { ...sec, refreshToken: t.refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt },
      { email: t.email, connectedAt: Date.now(), needsReconnect: false, wantGmail, scopes: t.scopes },
    )
    calendarCache = null
    return googleStatus()
  } catch (err) {
    if (err instanceof GoogleAuthError) throw new GoogleError(err.message)
    throw err
  } finally {
    flow = null
  }
}

export function cancelGoogleConnect(): void {
  flow?.abort()
}

/** Revokes the grant at Google (best effort) and forgets the tokens; `forgetClient` also removes the client. */
export async function disconnectGoogle(forgetClient: boolean): Promise<GoogleStatus> {
  const sec = secretsOf(load())
  const token = sec?.refreshToken ?? sec?.accessToken
  if (token) {
    try {
      await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      /* offline: the local tokens are forgotten anyway; access can also be removed at myaccount.google.com */
    }
  }
  calendarCache = null
  if (forgetClient || !sec) {
    rmSync(file(), { force: true })
  } else {
    save({ ...sec, refreshToken: null, accessToken: null, expiresAt: 0 }, { ...metaOf(null), wantGmail: !!load()?.wantGmail })
  }
  return googleStatus()
}

async function accessToken(signal?: AbortSignal): Promise<string> {
  const stored = load()
  const sec = secretsOf(stored)
  if (!sec?.refreshToken) throw new GoogleError('Google is not connected. Connect it in Settings → Connections.')
  if (stored?.needsReconnect) throw new GoogleError('Google sign-in has expired. Reconnect Google in Settings → Connections.')
  if (sec.accessToken && sec.expiresAt - Date.now() > 60_000) return sec.accessToken
  let t: GoogleTokens
  try {
    t = await refreshAccessToken({ clientId: sec.clientId, clientSecret: sec.clientSecret, refreshToken: sec.refreshToken, fetchFn: nodeFetch, signal })
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      if (err.reconnect && stored) save(sec, { ...metaOf(stored), needsReconnect: true })
      throw new GoogleError(err.message)
    }
    throw err
  }
  save({ ...sec, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt }, {
    ...metaOf(stored),
    email: t.email ?? stored?.email ?? null,
    connectedAt: stored?.connectedAt ?? Date.now(),
    needsReconnect: false,
    // A refresh reports the scopes of the grant; keep the earlier list if it doesn't.
    scopes: t.scopes.length ? t.scopes : (stored?.scopes ?? []),
  })
  return t.accessToken
}

async function calendarGet(path: string, signal?: AbortSignal): Promise<unknown> {
  const token = await accessToken(signal)
  let res: Response
  try {
    res = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new GoogleError("Couldn't reach Google Calendar. Check the internet connection.")
  }
  const text = await res.text()
  if (!res.ok) throw new GoogleError(describeApiError(res.status, text))
  try {
    return JSON.parse(text)
  } catch {
    throw new GoogleError('Google Calendar sent an unreadable answer.')
  }
}

let calendarCache: { at: number; list: CalendarInfo[] } | null = null

async function calendars(signal?: AbortSignal): Promise<CalendarInfo[]> {
  if (calendarCache && Date.now() - calendarCache.at < 10 * 60_000) return calendarCache.list
  const list = parseCalendarList(await calendarGet('/users/me/calendarList?minAccessRole=reader&maxResults=50', signal))
  calendarCache = { at: Date.now(), list: list.length ? list : [{ id: 'primary', name: 'Calendar', primary: true }] }
  return calendarCache.list
}

/** Events between two instants from every calendar the owner shows in Google Calendar. */
export async function listEvents(start: number, end: number, signal?: AbortSignal): Promise<CalendarEvent[]> {
  const cals = await calendars(signal)
  const lists = await Promise.all(cals.map(async (c) => parseEvents(await calendarGet(eventsPath(c.id, start, end), signal), c.name)))
  return mergeEvents(lists).filter((e) => e.end > start && e.start < end)
}

/**
 * Creates one Gmail draft (Sprint 20). This is the only Gmail request JARVIS can make: there is no
 * code anywhere that sends mail — the owner reviews and sends drafts in Gmail.
 */
export async function createGmailDraft(d: DraftInput, signal?: AbortSignal): Promise<{ draftId: string; email: string | null }> {
  if (!gmailReady()) throw new GoogleError('Gmail drafts are not switched on and connected. Settings → Connections → Google.')
  const token = await accessToken(signal)
  let res: Response
  try {
    res = await fetch(GMAIL_DRAFTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(draftRequestBody(d)),
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new GoogleError("Couldn't reach Gmail. Check the internet connection.")
  }
  const text = await res.text()
  if (!res.ok) throw new GoogleError(describeApiError(res.status, text, 'Gmail'))
  let parsed: ReturnType<typeof parseDraftResponse> = null
  try {
    parsed = parseDraftResponse(JSON.parse(text))
  } catch {
    /* handled below */
  }
  if (!parsed) throw new GoogleError('Gmail did not confirm the draft.')
  return { draftId: parsed.draftId, email: load()?.email ?? null }
}
