import { describeOpenAIError, OPENAI_API } from '../shared/realtime.ts'

// Network calls to OpenAI. Main process only: this is the only place the API key is used.

const TIMEOUT_MS = 20_000

export type OpenAIResult<T> = { ok: true; value: T } | { ok: false; status: number; body: string; message: string }

function networkFailure(err: unknown): { ok: false; status: number; body: string; message: string } {
  const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
  return {
    ok: false,
    status: 0,
    body: '',
    message: timedOut
      ? "OpenAI didn't respond in time. Check your internet connection and try again."
      : "Couldn't reach OpenAI. Check your internet connection and try again.",
  }
}

/** Confirms a key works by listing models (cheap, read-only, no tokens billed). */
export async function verifyKey(key: string): Promise<OpenAIResult<true>> {
  try {
    const res = await fetch(`${OPENAI_API}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return { ok: true, value: true }
    const body = await res.text()
    return { ok: false, status: res.status, body, message: describeOpenAIError(res.status, body) }
  } catch (err) {
    return networkFailure(err)
  }
}

/**
 * WebRTC "unified interface": relay the renderer's SDP offer plus session config to OpenAI
 * with the real key, and return the answer SDP. The renderer never sees any credential.
 */
export async function createRealtimeCall(
  key: string,
  offerSdp: string,
  session: Record<string, unknown>,
): Promise<OpenAIResult<string>> {
  const form = new FormData()
  form.set('sdp', offerSdp)
  form.set('session', JSON.stringify(session))
  try {
    const res = await fetch(`${OPENAI_API}/realtime/calls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.text()
    if (res.ok) return { ok: true, value: body }
    return { ok: false, status: res.status, body, message: describeOpenAIError(res.status, body) }
  } catch (err) {
    return networkFailure(err)
  }
}

/** Typed reply via the Responses API. Returns the raw JSON for parsing by shared/text.ts. */
export async function createTextResponse(key: string, body: Record<string, unknown>): Promise<OpenAIResult<unknown>> {
  try {
    const res = await fetch(`${OPENAI_API}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, status: res.status, body: text, message: describeOpenAIError(res.status, text) }
    try {
      return { ok: true, value: JSON.parse(text) as unknown }
    } catch {
      return { ok: false, status: res.status, body: '', message: 'OpenAI sent a reply Jarvis could not read.' }
    }
  } catch (err) {
    return networkFailure(err)
  }
}
