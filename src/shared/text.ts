// Typed replies via the OpenAI Responses API (POST /v1/responses). Pure helpers, unit-tested.
// Checked 2026-11-09: gpt-5.4-mini supports the Responses API with reasoning effort "none" by default;
// raw REST responses carry text in output[].content[] items of type "output_text".

import { textModelProvider, type ChatTurn, type HonorificId, type PersonaId, type TextModelId, type TextUsage } from './ipc.ts'
import { buildAnthropicRequest } from './anthropic.ts'
import { openAITools, type ToolSpec } from './tools.ts'
import { buildInstructions } from './realtime.ts'

export interface TextRequestOptions {
  model: TextModelId
  workspaceName: string
  persona: PersonaId
  honorific: HonorificId
  history: ChatTurn[]
  message: string
  memories?: { global: string[]; workspace: string[] }
  /** Tools offered for this message (Sprint 8). */
  tools?: ToolSpec[]
}

/** Same persona, memory and limits as voice; replies are short plain sentences that also read well aloud. */
export function textInstructions(o: TextRequestOptions): string {
  return buildInstructions({
    workspaceName: o.workspaceName,
    persona: o.persona,
    honorific: o.honorific,
    output: 'text',
    memories: o.memories,
    tools: o.tools,
  })
}

/** Request body for whichever provider serves the chosen model. */
export function buildProviderRequest(o: TextRequestOptions): Record<string, unknown> {
  return textModelProvider(o.model) === 'anthropic'
    ? buildAnthropicRequest({ model: o.model, instructions: textInstructions(o), history: o.history, message: o.message, tools: o.tools })
    : buildTextRequest(o)
}

/** OpenAI Responses API body. */
export function buildTextRequest(o: TextRequestOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: o.model,
    instructions: textInstructions(o),
    input: [...o.history.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: o.message }],
    max_output_tokens: 1200,
    store: false, // don't keep conversations on OpenAI's side
  }
  // gpt-5-mini reasons by default (slower); keep it brief. gpt-5.4-mini defaults to no reasoning.
  if (o.model === 'gpt-5-mini') body.reasoning = { effort: 'low' }
  if (o.tools?.length) {
    body.tools = openAITools(o.tools)
    // store:false keeps nothing on OpenAI's side, so any reasoning must travel with tool results.
    body.include = ['reasoning.encrypted_content']
  }
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

/**
 * USD per 1M tokens (checked 2026-11-09): developers.openai.com model pages and
 * platform.claude.com/docs pricing. Haiku 5.5 is priced by prompt length: above 100 000
 * prompt tokens the whole request uses the higher tier.
 */
type Price = { input: number; cached: number; output: number }
const TEXT_PRICES: Record<TextModelId, Price | { upTo100k: Price; above100k: Price }> = {
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2 },
  'claude-haiku-5-5': {
    upTo100k: { input: 0.1, cached: 0.01, output: 0.5 },
    above100k: { input: 0.5, cached: 0.05, output: 2.5 },
  },
  'claude-sonnet-5-5': { input: 2, cached: 0.1, output: 10 },
  'claude-opus-5-5': { input: 4, cached: 0.2, output: 20 },
}

export function estimateTextCostUsd(model: TextModelId, u: TextUsage): number {
  const entry = TEXT_PRICES[model]
  const p = 'upTo100k' in entry ? (u.inputTokens > 100_000 ? entry.above100k : entry.upTo100k) : entry
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens)
  return (fresh * p.input + u.cachedTokens * p.cached + u.outputTokens * p.output) / 1_000_000
}
