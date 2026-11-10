// Pure helpers for the OpenAI Realtime API (GA). No Electron/Node imports — unit-tested.
// Verified against developers.openai.com on 2026-11-08:
//  - WebRTC "unified interface": POST multipart {sdp, session} to /v1/realtime/calls with the API key;
//    response body is the answer SDP.
//  - Session config is GA-shaped: { type: 'realtime', model, instructions, audio: { input, output } }.

import type { HonorificId, PersonaId, RealtimeModelId, VoiceId } from './ipc.ts'
import { realtimeTools, toolInstructions, type ToolSpec } from './tools.ts'
import { formatMemorySection } from './memory.ts'

export const OPENAI_API = 'https://api.openai.com/v1'

/** Input transcription model for showing what the user said. Optional: the session works without it. */
export const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe'

export interface SessionOptions {
  model: RealtimeModelId
  voice: VoiceId
  workspaceName: string
  transcription: boolean
  persona: PersonaId
  honorific: HonorificId
  /** 'audio' = OpenAI speaks; 'text' = OpenAI replies in text and ElevenLabs speaks it. */
  output: 'audio' | 'text'
  /** Saved facts for this workspace and globally (Sprint 6). */
  memories?: { global: string[]; workspace: string[] }
  /** Tools offered this session (Sprint 8). Omitted or empty = no tools. */
  tools?: ToolSpec[]
}

const TITLE: Record<HonorificId, string | null> = { none: null, sir: 'sir', maam: "ma'am" }

// Structured per OpenAI's realtime prompting guide: short labelled sections, precise rules,
// and sample phrases (the model follows these closely). Phrases are original, not film quotes.
const BRITISH_BUTLER = (title: string | null): string[] => [
  '# Personality and tone',
  '- Composed, courteous and quietly confident, like a highly competent English butler who also runs the household systems.',
  '- Dry, understated wit, used sparingly. Never sarcastic toward the owner, never gushing, never overly enthusiastic.',
  '- Warm but economical with words.',
  '',
  '# Accent and delivery',
  '- ALWAYS speak with a refined southern English accent (Received Pronunciation), for every word of every reply.',
  '- Non-rhotic: do not pronounce the "r" at the ends of words ("better" sounds like "bet-uh").',
  '- Long, open "a" in words like "can\'t", "rather", "answer", "afternoon". Crisp "t" sounds; never turn "t" into a "d" ("water", "matter").',
  '- Use British vocabulary and spelling: "schedule" said "shed-yule", "brilliant", "rather", "I\'m afraid", "shall I".',
  '- Measured, unhurried pace with clear enunciation; a slight downward lilt at the end of statements.',
  '- Keep the accent even when the owner speaks with a different accent, and even when switching topics.',
  '',
  '# Form of address',
  title
    ? `- Address the owner as "${title}" naturally, roughly once per reply, not in every sentence.`
    : '- Do not use "sir", "madam" or other titles. Address the owner directly without a title.',
  '',
  '# Sample phrases (vary them; do not repeat the same one twice in a row)',
  `- "Certainly${title ? `, ${title}` : ''}. One moment."`,
  '- "I\'m afraid that isn\'t connected just yet."',
  '- "Shall I make a note of that for later?"',
  '- "Rather a full afternoon, by the look of it."',
  `- "Good morning${title ? `, ${title}` : ''}. Everything\'s running smoothly."`,
]

const NEUTRAL = (title: string | null): string[] => [
  '# Personality and tone',
  '- Friendly, clear and professional. Natural conversational pace.',
  title ? `- Address the owner as "${title}" occasionally.` : '- Do not use titles like "sir" or "madam".',
]

const SPOKEN_TEXT = [
  '# Output format',
  '- Your replies are read aloud by a separate British text-to-speech voice.',
  '- Write plain spoken sentences only: no markdown, lists, headings, emoji, URLs or code.',
  '- Use British spelling and vocabulary. Write numbers the way they should be said.',
]

/** True for lines inside the "# Accent and delivery" section (heading through the blank line after it). */
function isAccentLine(lines: string[], i: number): boolean {
  const start = lines.indexOf('# Accent and delivery')
  if (start < 0 || i < start) return false
  const end = lines.indexOf('', start)
  return i <= (end < 0 ? lines.length - 1 : end)
}

export function buildInstructions(
  o: Pick<SessionOptions, 'workspaceName' | 'persona' | 'honorific'> & {
    output?: 'audio' | 'text'
    memories?: SessionOptions['memories']
    tools?: ToolSpec[]
  },
): string {
  const memory = o.memories ? formatMemorySection(o.memories, o.workspaceName) : []
  const tools = toolInstructions(o.tools ?? [])
  const title = TITLE[o.honorific]
  const persona = o.persona === 'british-butler' ? BRITISH_BUTLER(title) : NEUTRAL(title)
  // In text mode the accent comes from the ElevenLabs voice, so pronunciation rules are dropped.
  const personaLines =
    o.output === 'text' ? persona.filter((_, i, all) => !isAccentLine(all, i)) : persona
  return [
    '# Role and objective',
    '- You are JARVIS, a personal assistant speaking with your owner through a desktop app.',
    `- The active workspace is "${o.workspaceName}".`,
    '',
    ...personaLines,
    '',
    ...(o.output === 'text' ? [...SPOKEN_TEXT, ''] : []),
    ...(memory.length ? [...memory, ''] : []),
    ...tools,
    '',
    '# Length',
    '- One to three sentences per reply unless the owner asks for more.',
    '',
    '# Limits (always follow)',
    '- You cannot read email, calendars, files or any other data, and you cannot act beyond the tools listed above.',
    '- If asked to do something you have no tool for, say plainly that the capability is not connected yet.',
    '- Never pretend to have done something or invent information about the owner.',
    '- You are an original assistant. If asked, do not claim to be a character from a film or imitate a specific real person.',
  ].join('\n')
}

/** Session object for /v1/realtime/calls (and client_secrets). WebRTC negotiates audio format, so none is set. */
export function buildRealtimeSession(o: SessionOptions): Record<string, unknown> {
  const input: Record<string, unknown> = {
    turn_detection: { type: 'server_vad', interrupt_response: true, create_response: true },
  }
  if (o.transcription) input.transcription = { model: TRANSCRIPTION_MODEL }
  const tools = o.tools?.length ? { tools: realtimeTools(o.tools), tool_choice: 'auto' } : {}
  if (o.output === 'text') {
    return {
      type: 'realtime',
      model: o.model,
      output_modalities: ['text'],
      instructions: buildInstructions(o),
      audio: { input },
      ...tools,
    }
  }
  return {
    type: 'realtime',
    model: o.model,
    instructions: buildInstructions(o),
    audio: { input, output: { voice: o.voice } },
    ...tools,
  }
}

/** Function calls in a Realtime `response.done` event's response.output (Sprint 8). */
export function realtimeToolCalls(response: unknown): Array<{ callId: string; name: string; arguments: string }> {
  const out = response && typeof response === 'object' ? (response as { output?: unknown }).output : undefined
  if (!Array.isArray(out)) return []
  const calls: Array<{ callId: string; name: string; arguments: string }> = []
  for (const item of out) {
    if (!item || typeof item !== 'object') continue
    const i = item as Record<string, unknown>
    if (i.type !== 'function_call' || typeof i.call_id !== 'string' || typeof i.name !== 'string') continue
    calls.push({ callId: i.call_id, name: i.name, arguments: typeof i.arguments === 'string' ? i.arguments : '{}' })
  }
  return calls
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
