// Google OAuth for a desktop app (Sprint 19): PKCE + a one-shot loopback listener on 127.0.0.1.
// Node only, no Electron: the browser opener and fetch are injected so the whole flow is tested
// with a fake token endpoint and a simulated browser redirect.
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildAuthUrl, describeTokenError, GOOGLE_TOKEN_URL, parseCallback, parseTokenResponse, type GoogleTokens } from '../shared/google.ts'

export class GoogleAuthError extends Error {
  readonly reconnect: boolean
  constructor(message: string, reconnect = false) {
    super(message)
    this.reconnect = reconnect
  }
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

const PAGE = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#0b0906;color:#f3e7cf;display:grid;place-items:center;height:90vh"><div><h1 style="font-weight:400">${title}</h1><p>${body}</p></div>`

async function postForm(fetchFn: FetchFn, params: Record<string, string>, signal?: AbortSignal): Promise<GoogleTokens> {
  let res
  try {
    res = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    })
  } catch {
    throw new GoogleAuthError("Couldn't reach Google. Check the internet connection.")
  }
  const text = await res.text()
  if (!res.ok) {
    const d = describeTokenError(res.status, text)
    throw new GoogleAuthError(d.message, d.reconnect)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new GoogleAuthError('Google sent an unreadable answer.')
  }
  const tokens = parseTokenResponse(json, Date.now())
  if (!tokens) throw new GoogleAuthError('Google sent no access token.')
  return tokens
}

export interface FlowOptions {
  clientId: string
  clientSecret: string | null
  /** Opens the consent page in the owner's browser. */
  openUrl: (url: string) => Promise<void> | void
  fetchFn: FetchFn
  /** How long to wait for the owner to finish in the browser. */
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Starts a listener on a random 127.0.0.1 port, opens Google's consent page, waits for the single
 * redirect back (state checked), exchanges the code with the PKCE verifier, and closes the listener.
 */
export async function runLoopbackFlow(o: FlowOptions): Promise<GoogleTokens> {
  const { verifier, challenge } = pkcePair()
  const state = b64url(randomBytes(16))
  let settle: (r: { code: string } | { error: string }) => void = () => undefined
  const result = new Promise<{ code: string } | { error: string }>((resolve) => {
    settle = resolve
  })
  let done = false

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    // Browsers also ask for /favicon.ico etc.: only the redirect itself carries Google's parameters.
    if (done || req.method !== 'GET' || (!url.searchParams.has('code') && !url.searchParams.has('error'))) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }
    const r = parseCallback(req.url ?? '/', state)
    if (!r.ok && r.error === 'state_mismatch') {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('This sign-in link is not the one JARVIS started.')
      return
    }
    done = true
    const ok = r.ok
    res
      .writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(ok ? PAGE('JARVIS is connected', 'You can close this tab and go back to JARVIS.') : PAGE('JARVIS was not connected', 'Google said no or the sign-in was cancelled. You can close this tab.'))
    settle(r.ok ? { code: r.code } : { error: r.error })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  const redirectUri = `http://127.0.0.1:${port}`
  const timeout = setTimeout(() => settle({ error: 'timeout' }), o.timeoutMs ?? 5 * 60_000)
  const onAbort = (): void => settle({ error: 'cancelled' })
  o.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await o.openUrl(buildAuthUrl({ clientId: o.clientId, redirectUri, codeChallenge: challenge, state }))
    const r = await result
    if ('error' in r) {
      if (r.error === 'timeout') throw new GoogleAuthError('Google sign-in timed out. Try again and finish in the browser within 5 minutes.')
      if (r.error === 'cancelled') throw new GoogleAuthError('Google sign-in was cancelled.')
      if (r.error === 'access_denied') throw new GoogleAuthError('You declined access in Google, so nothing was connected.')
      throw new GoogleAuthError(`Google sign-in failed (${r.error}).`)
    }
    const params: Record<string, string> = {
      client_id: o.clientId,
      code: r.code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }
    if (o.clientSecret) params.client_secret = o.clientSecret
    const tokens = await postForm(o.fetchFn, params, o.signal)
    if (!tokens.refreshToken) throw new GoogleAuthError('Google did not grant lasting access. Try connecting again.')
    return tokens
  } finally {
    clearTimeout(timeout)
    o.signal?.removeEventListener('abort', onAbort)
    server.close()
    server.closeAllConnections?.()
  }
}

export async function refreshAccessToken(o: {
  clientId: string
  clientSecret: string | null
  refreshToken: string
  fetchFn: FetchFn
  signal?: AbortSignal
}): Promise<GoogleTokens> {
  const params: Record<string, string> = { client_id: o.clientId, grant_type: 'refresh_token', refresh_token: o.refreshToken }
  if (o.clientSecret) params.client_secret = o.clientSecret
  const t = await postForm(o.fetchFn, params, o.signal)
  return { ...t, refreshToken: t.refreshToken ?? o.refreshToken }
}
