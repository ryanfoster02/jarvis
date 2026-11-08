// Pure helpers for the OpenAI Realtime API (GA). No Electron/Node imports — unit-tested.
// Verified against developers.openai.com on 2026-11-08:
//  - WebRTC "unified interface": POST multipart {sdp, session} to /v1/realtime/calls with the API key;
//    response body is the answer SDP.
//  - Session config is GA-shaped: { type: 'realtime', model, instructions, audio: { input, output } }.

import type { RealtimeModelId, VoiceId } from './ipc.ts'

export const OPENAI_API = 'https://api.openai.com/v1'

/** Input transcription model for showing what the user said. Optional: the session works without it. */
export const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe'

export interface SessionOptions {
  model: RealtimeModelId
  voice: VoiceId
  workspaceName: string
  transcription: boolean
}

export function buildInstructions(workspaceName: string): string {
  return [
    'You are JARVIS, a calm, capable personal assistant speaking with your owner through a desktop app.',
    'Speak naturally and briefly: one to three sentences unless asked for more.',
    `The active workspace is "${workspaceName}".`,
    'You cannot yet take actions, read email, calendars, files or any other data, or remember past sessions.',
    'If asked to do any of those, say plainly that the capability is not connected yet. Never pretend to have done something.',
  ].join(' ')
}

/** Session object for /v1/realtime/calls (and client_secrets). WebRTC negotiates audio format, so none is set. */
export function buildRealtimeSession(o: SessionOptions): Record<string, unknown> {
  const input: Record<string, unknown> = {
    turn_detection: { type: 'server_vad', interrupt_response: true, create_response: true },
  }
  if (o.transcription) input.transcription = { model: TRANSCRIPTION_MODEL }
  return {
    type: 'realtime',
    model: o.model,
    instructions: buildInstructions(o.workspaceName),
    audio: { input, output: { voice: o.voice } },
  }
}

/** Turn an OpenAI error response into a short, actionable message. Never includes the key. */
export function describeOpenAIError(status: number, body: string): string {
  let detail = ''
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const err = (parsed as { error?: { message?: unknown } }).error
      if (err && typeof err.message === 'string') detail = err.message
    }
  } catch {
    /* not JSON */
  }
  detail = detail.replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-…').slice(0, 300)
  if (status === 401) return 'OpenAI rejected the API key. Check it in Settings → AI provider.'
  if (status === 403) return `OpenAI refused access${detail ? `: ${detail}` : '. Your key may not have Realtime access.'}`
  if (status === 429) return `OpenAI rate limit or quota reached${detail ? `: ${detail}` : '. Check your billing.'}`
  if (status >= 500) return `OpenAI had a server error (${status}). Try again in a moment.`
  return detail ? `OpenAI error (${status}): ${detail}` : `OpenAI error (${status}).`
}

/** True if a 4xx error was caused by the optional transcription setting, so we can retry without it. */
export function isTranscriptionConfigError(status: number, body: string): boolean {
  return status === 400 && /transcri/i.test(body)
}

// ---------- Usage & cost ----------

export interface RealtimeUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number }
  output_token_details?: { text_tokens?: number; audio_tokens?: number }
}

/** USD per 1M tokens. Only models with published prices are listed; others report no estimate. */
const PRICES: Partial<Record<RealtimeModelId, { textIn: number; audioIn: number; cachedIn: number; textOut: number; audioOut: number }>> = {
  // developers.openai.com/api/docs/models/gpt-realtime-2.1-mini (checked 2026-11-08).
  // Cached rate uses the text cached price, a slight under-estimate for cached audio.
  'gpt-realtime-2.1-mini': { textIn: 0.6, audioIn: 10, cachedIn: 0.06, textOut: 2.4, audioOut: 20 },
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Estimated cost of one response's usage in USD, or null when the model has no known price. */
export function estimateCostUsd(model: RealtimeModelId, usage: RealtimeUsage | undefined): number | null {
  const p = PRICES[model]
  if (!p) return null
  if (!usage) return 0
  const inD = usage.input_token_details ?? {}
  const outD = usage.output_token_details ?? {}
  const cached = n(inD.cached_tokens)
  const textIn = Math.max(0, n(inD.text_tokens) - cached)
  const audioIn = n(inD.audio_tokens)
  const textOut = n(outD.text_tokens)
  const audioOut = n(outD.audio_tokens)
  return (textIn * p.textIn + audioIn * p.audioIn + cached * p.cachedIn + textOut * p.textOut + audioOut * p.audioOut) / 1_000_000
}

export const totalTokens = (usage: RealtimeUsage | undefined): number =>
  n(usage?.total_tokens) || n(usage?.input_tokens) + n(usage?.output_tokens)

// ---------- Server event names (GA, with beta spellings accepted) ----------

export const EV = {
  speechStarted: 'input_audio_buffer.speech_started',
  speechStopped: 'input_audio_buffer.speech_stopped',
  userTranscript: 'conversation.item.input_audio_transcription.completed',
  userTranscriptFailed: 'conversation.item.input_audio_transcription.failed',
  assistantTranscriptDelta: ['response.output_audio_transcript.delta', 'response.audio_transcript.delta'],
  assistantTranscriptDone: ['response.output_audio_transcript.done', 'response.audio_transcript.done'],
  assistantTextDelta: ['response.output_text.delta', 'response.text.delta'],
  assistantTextDone: ['response.output_text.done', 'response.text.done'],
  audioStarted: 'output_audio_buffer.started',
  audioStopped: ['output_audio_buffer.stopped', 'output_audio_buffer.cleared'],
  responseDone: 'response.done',
  error: 'error',
} as const

export const isOneOf = (type: string, names: string | readonly string[]): boolean =>
  typeof names === 'string' ? type === names : names.includes(type)
