import { describeElevenLabsError, ELEVEN_API, ELEVEN_OUTPUT_FORMAT, isAuthenticatedButRestricted } from '../shared/elevenlabs.ts'
import type { ElevenModelId } from '../shared/ipc.ts'

// ElevenLabs calls. Main process only: the only place the ElevenLabs key is used.

const TIMEOUT_MS = 20_000

export type ElevenResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string }

function networkFailure(err: unknown): { ok: false; status: number; message: string } {
  const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
  return {
    ok: false,
    status: 0,
    message: timedOut
      ? "ElevenLabs didn't respond in time. Check your internet connection."
      : "Couldn't reach ElevenLabs. Check your internet connection.",
  }
}

/**
 * Confirms a key authenticates (no characters billed). A key restricted to Text to Speech
 * can't read the subscription, but ElevenLabs still recognised it, so it counts as valid.
 */
export async function verifyElevenLabsKey(key: string): Promise<ElevenResult<true>> {
  try {
    const res = await fetch(`${ELEVEN_API}/user/subscription`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return { ok: true, value: true }
    const body = await res.text()
    if (isAuthenticatedButRestricted(res.status, body)) return { ok: true, value: true }
    return { ok: false, status: res.status, message: describeElevenLabsError(res.status, body) }
  } catch (err) {
    return networkFailure(err)
  }
}

/** Synthesizes one chunk of speech as MP3 bytes via the streaming endpoint. */
export async function synthesize(
  key: string,
  voiceId: string,
  model: ElevenModelId,
  text: string,
): Promise<ElevenResult<Uint8Array>> {
  const url = `${ELEVEN_API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${ELEVEN_OUTPUT_FORMAT}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, status: res.status, message: describeElevenLabsError(res.status, body) }
    }
    return { ok: true, value: new Uint8Array(await res.arrayBuffer()) }
  } catch (err) {
    return networkFailure(err)
  }
}
