// Typed replies via the OpenAI Responses API (POST /v1/responses). Pure helpers, unit-tested.
// Checked 2026-11-09: gpt-5.4-mini supports the Responses API with reasoning effort "none" by default;
// raw REST responses carry text in output[].content[] items of type "output_text".

import type { ChatTurn, HonorificId, PersonaId, TextModelId, TextUsage } from './ipc.ts'
import { buildInstructions } from './realtime.ts'

export interface TextRequestOptions {
  model: TextModelId
  workspaceName: string
  persona: PersonaId
  honorific: HonorificId
  history: ChatTurn[]
  message: string
  memories?: { global: string[]; workspace: string[] }
}

export function buildTextRequest(o: TextRequestOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: o.model,
    // Same persona and limits as voice; replies are short plain sentences that also read well aloud.
    instructions: buildInstructions({
      workspaceName: o.workspaceName,
      persona: o.persona,
      honorific: o.honorific,
      output: 'text',
      memories: o.memories,
    }),
    input: [...o.history.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: o.message }],
    max_output_tokens: 1200,
    store: false, // don't keep conversations on OpenAI's side
  }
  // gpt-5-mini reasons by default (slower); keep it brief. gpt-5.4-mini defaults to no reasoning.
  if (o.model === 'gpt-5-mini') body.reasoning = { effort: 'low' }
  return body
}

interface ResponsesJson {
  status?: string
  output_text?: unknown
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }>
  usage?: { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } }
  incomplete_details?: { reason?: unknown }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export function parseResponsesOutput(json: unknown): { text: string; usage: TextUsage; incomplete: string | null } {
  const r = (json && typeof json === 'object' ? json : {}) as ResponsesJson
  let text = ''
  for (const item of r.output ?? []) {
    if (item.type !== 'message') continue
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') text += c.text
    }
  }
  if (!text && typeof r.output_text === 'string') text = r.output_text
  const usage: TextUsage = {
    inputTokens: num(r.usage?.input_tokens),
    outputTokens: num(r.usage?.output_tokens),
    cachedTokens: num(r.usage?.input_tokens_details?.cached_tokens),
  }
  const incomplete = r.status === 'incomplete' ? String(r.incomplete_details?.reason ?? 'incomplete') : null
  return { text: text.trim(), usage, incomplete }
}

/** USD per 1M tokens, from developers.openai.com model pages (checked 2026-11-09). */
const TEXT_PRICES: Record<TextModelId, { input: number; cached: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2 },
}

export function estimateTextCostUsd(model: TextModelId, u: TextUsage): number {
  const p = TEXT_PRICES[model]
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens)
  return (fresh * p.input + u.cachedTokens * p.cached + u.outputTokens * p.output) / 1_000_000
}
