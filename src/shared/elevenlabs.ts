// Pure helpers for the ElevenLabs API. Verified against elevenlabs.io docs on 2026-11-08:
//  - POST /v1/text-to-speech/{voice_id}/stream, header xi-api-key, JSON { text, model_id }, query output_format.
//  - GET /v1/user/subscription for a cheap key check (no characters billed).

export const ELEVEN_API = 'https://api.elevenlabs.io/v1'
export const ELEVEN_OUTPUT_FORMAT = 'mp3_44100_128'

interface ElevenErrorBody {
  detail?: { status?: string; message?: string } | string
}

function parse(body: string): { status: string; message: string } {
  try {
    const parsed = JSON.parse(body) as ElevenErrorBody
    if (typeof parsed.detail === 'string') return { status: '', message: parsed.detail }
    return { status: parsed.detail?.status ?? '', message: parsed.detail?.message ?? '' }
  } catch {
    return { status: '', message: '' }
  }
}

/** A key that authenticates but lacks the user-read permission is still a working key for speech. */
export function isAuthenticatedButRestricted(status: number, body: string): boolean {
  return status === 401 && parse(body).status === 'missing_permissions'
}

/** Short, actionable message. Never includes the key. */
export function describeElevenLabsError(status: number, body: string): string {
  const { status: code, message } = parse(body)
  const detail = message.replace(/sk_[A-Za-z0-9]{4,}/g, 'sk_…').slice(0, 240)
  if (status === 401 && code === 'missing_permissions') {
    return 'Your ElevenLabs key is missing the Text to Speech permission. Edit the key in ElevenLabs and enable it.'
  }
  if (status === 401) return 'ElevenLabs rejected the API key. Check it in Settings → AI provider.'
  if (status === 404 || code === 'voice_not_found') {
    return "ElevenLabs couldn't find that voice for your account. Add it to My Voices in ElevenLabs, or pick another voice in Settings → Voice."
  }
  if (status === 429 || code === 'quota_exceeded') {
    return `ElevenLabs quota or rate limit reached${detail ? `: ${detail}` : '.'}`
  }
  if (status === 400 && /voice/i.test(message)) return `ElevenLabs voice problem: ${detail}`
  if (status >= 500) return `ElevenLabs had a server error (${status}). Try again in a moment.`
  return detail ? `ElevenLabs error (${status}): ${detail}` : `ElevenLabs error (${status}).`
}
