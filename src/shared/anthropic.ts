// Anthropic Messages API helpers (typed replies with Claude). Pure; unit-tested.
// Checked against platform.claude.com docs 2026-11-09:
//  - POST /v1/messages, headers x-api-key + anthropic-version, JSON {model, max_tokens, system, messages}.
//  - Response: content[] blocks ({type:'text', text}), stop_reason, usage {input_tokens, output_tokens,
//    cache_read_input_tokens, cache_creation_input_tokens}. Errors: {type:'error', error:{type, message}}.
// The long-stable 2023-06-01 version is used (top-level `system`); the docs' own model-list example uses it.

import type { ChatTurn, TextUsage } from './ipc.ts'
import { anthropicTools, type ToolSpec } from './tools.ts'

export const ANTHROPIC_API = 'https://api.anthropic.com/v1'
export const ANTHROPIC_VERSION = '2023-06-01'

/**
 * The Messages API is strictest with a conversation that starts with the user and alternates roles.
 * Stored history can break that (e.g. a voice turn with no reply), so merge same-role neighbours and
 * drop anything before the first user turn. The new message is always last.
 */
export function toAnthropicMessages(history: ChatTurn[], message: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns = [...history, { role: 'user' as const, text: message }]
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const t of turns) {
    const text = t.text.trim()
    if (!text) continue
    if (out.length === 0 && t.role !== 'user') continue
    const last = out.at(-1)
    if (last && last.role === t.role) last.content = `${last.content}\n\n${text}`
    else out.push({ role: t.role, content: text })
  }
  return out
}

export function buildAnthropicRequest(o: {
  model: string
  instructions: string
  history: ChatTurn[]
  message: string
  maxTokens?: number
  tools?: ToolSpec[]
}): Record<string, unknown> {
  return {
    model: o.model,
    max_tokens: o.maxTokens ?? 1200,
    system: o.instructions,
    messages: toAnthropicMessages(o.history, o.message),
    ...(o.tools?.length ? { tools: anthropicTools(o.tools) } : {}),
  }
}

interface AnthropicJson {
  content?: Array<{ type?: string; text?: unknown }>
  stop_reason?: string
  usage?: {
    input_tokens?: unknown
    output_tokens?: unknown
    cache_read_input_tokens?: unknown
    cache_creation_input_tokens?: unknown
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export function parseAnthropicResponse(json: unknown): { text: string; usage: TextUsage; incomplete: string | null } {
  const r = (json && typeof json === 'object' ? json : {}) as AnthropicJson
  const text = (r.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim()
  const cacheRead = num(r.usage?.cache_read_input_tokens)
  const cacheWrite = num(r.usage?.cache_creation_input_tokens)
  // Anthropic's input_tokens excludes cache reads/writes; report the full prompt size.
  const usage: TextUsage = {
    inputTokens: num(r.usage?.input_tokens) + cacheRead + cacheWrite,
    outputTokens: num(r.usage?.output_tokens),
    cachedTokens: cacheRead,
  }
  const incomplete =
    r.stop_reason === 'max_tokens' || r.stop_reason === 'model_context_window_exceeded'
      ? r.stop_reason
      : r.stop_reason === 'refusal'
        ? 'refusal'
        : null
  return { text, usage, incomplete }
}

/** Short, actionable message. Never includes the key. */
export function describeAnthropicError(status: number, body: string): string {
  let type = ''
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { type?: unknown; message?: unknown } }
    if (typeof parsed.error?.type === 'string') type = parsed.error.type
    if (typeof parsed.error?.message === 'string') detail = parsed.error.message
  } catch {
    /* not JSON */
  }
  detail = detail.replace(/sk-ant-[A-Za-z0-9_-]{4,}/g, 'sk-ant-…').slice(0, 300)
  if (status === 401 || type === 'authentication_error') return 'Anthropic rejected the API key. Check it in Settings → AI provider.'
  if (status === 403 || type === 'permission_error') return `Anthropic refused access${detail ? `: ${detail}` : '.'}`
  if (status === 404 || type === 'not_found_error') return `Anthropic couldn't find that model${detail ? `: ${detail}` : '.'} Pick another in Settings → Voice.`
  if (status === 429 || type === 'rate_limit_error') return `Anthropic rate limit reached${detail ? `: ${detail}` : '.'} Wait a moment.`
  if (status === 529 || type === 'overloaded_error') return 'Anthropic is overloaded right now. Try again shortly, or switch to an OpenAI model.'
  if (status >= 500) return `Anthropic had a server error (${status}). Try again in a moment.`
  return detail ? `Anthropic error (${status}): ${detail}` : `Anthropic error (${status}).`
}
