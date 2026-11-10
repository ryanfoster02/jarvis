import { ANTHROPIC_API, ANTHROPIC_VERSION, describeAnthropicError } from '../shared/anthropic.ts'
import type { OpenAIResult as ProviderResult } from './openai.ts'

// Network calls to Anthropic. Main process only: this is the only place the Anthropic key is used.

const TIMEOUT_MS = 20_000

function headers(key: string): Record<string, string> {
  return { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' }
}

function networkFailure(err: unknown): { ok: false; status: number; body: string; message: string } {
  const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
  return {
    ok: false,
    status: 0,
    body: '',
    message: timedOut
      ? "Anthropic didn't respond in time. Check your internet connection and try again."
      : "Couldn't reach Anthropic. Check your internet connection and try again.",
  }
}

/** Confirms a key works by listing models (read-only, no tokens billed). */
export async function verifyAnthropicKey(key: string): Promise<ProviderResult<true>> {
  try {
    const res = await fetch(`${ANTHROPIC_API}/models?limit=1`, { headers: headers(key), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) return { ok: true, value: true }
    const body = await res.text()
    return { ok: false, status: res.status, body, message: describeAnthropicError(res.status, body) }
  } catch (err) {
    return networkFailure(err)
  }
}

/** Typed reply via the Messages API. Returns the raw JSON for parsing by shared/anthropic.ts. */
export async function createAnthropicMessage(key: string, body: Record<string, unknown>): Promise<ProviderResult<unknown>> {
  try {
    const res = await fetch(`${ANTHROPIC_API}/messages`, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, status: res.status, body: text, message: describeAnthropicError(res.status, text) }
    try {
      return { ok: true, value: JSON.parse(text) as unknown }
    } catch {
      return { ok: false, status: res.status, body: '', message: 'Anthropic sent a reply Jarvis could not read.' }
    }
  } catch (err) {
    return networkFailure(err)
  }
}
