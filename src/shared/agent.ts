// Agent loop for typed replies: model → tool calls → results → model … until a final answer,
// bounded by RunBudget (SECURITY.md §6) and the kill switch. Pure: network, tools and clock are
// injected, so the loop is unit-tested without either provider.

import type { ActionNote, TextProviderId, TextUsage } from './ipc.ts'
import type { RunBudget } from './permissions.ts'

export interface ToolCall {
  id: string
  name: string
  /** JSON string (OpenAI) or object (Anthropic); validated by parseToolArgs before use. */
  arguments: unknown
}

export interface ToolResult {
  id: string
  output: string
  isError: boolean
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

// ---------- Provider adapters ----------

/** Function calls in an OpenAI Responses API result. */
export function openAIToolCalls(json: unknown): ToolCall[] {
  const out = isObj(json) && Array.isArray(json.output) ? json.output : []
  return out
    .filter((i): i is Json => isObj(i) && i.type === 'function_call' && typeof i.call_id === 'string' && typeof i.name === 'string')
    .map((i) => ({ id: i.call_id as string, name: i.name as string, arguments: typeof i.arguments === 'string' ? i.arguments : '' }))
}

/** tool_use blocks in an Anthropic Messages API result. */
export function anthropicToolCalls(json: unknown): ToolCall[] {
  const content = isObj(json) && Array.isArray(json.content) ? json.content : []
  return content
    .filter((b): b is Json => isObj(b) && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
    .map((b) => ({ id: b.id as string, name: b.name as string, arguments: b.input ?? {} }))
}

/**
 * Next OpenAI request: everything the model returned goes back verbatim and in order (reasoning
 * items included — required with store:false), followed by one function_call_output per call.
 */
export function appendOpenAIResults(body: Json, json: unknown, results: ToolResult[]): Json {
  const input = Array.isArray(body.input) ? body.input : []
  const raw = isObj(json) && Array.isArray(json.output) ? json.output : []
  // A reasoning item without its encrypted content can't be resolved under store:false; leave it out.
  const output = raw.filter((i) => !(isObj(i) && i.type === 'reasoning' && typeof i.encrypted_content !== 'string'))
  return {
    ...body,
    input: [...input, ...output, ...results.map((r) => ({ type: 'function_call_output', call_id: r.id, output: r.output }))],
  }
}

/**
 * Next Anthropic request: the assistant turn with its full content, then a user turn whose content
 * is the tool_result blocks only (they must come first and immediately follow the tool_use turn).
 */
export function appendAnthropicResults(body: Json, json: unknown, results: ToolResult[]): Json {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const content = isObj(json) && Array.isArray(json.content) ? json.content : []
  return {
    ...body,
    messages: [
      ...messages,
      { role: 'assistant', content },
      {
        role: 'user',
        content: results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.output,
          ...(r.isError ? { is_error: true } : {}),
        })),
      },
    ],
  }
}

const ADAPTERS: Record<TextProviderId, { calls: (json: unknown) => ToolCall[]; append: (b: Json, j: unknown, r: ToolResult[]) => Json }> = {
  openai: { calls: openAIToolCalls, append: appendOpenAIResults },
  anthropic: { calls: anthropicToolCalls, append: appendAnthropicResults },
}

// ---------- Loop ----------

export type SendResult = { ok: true; value: unknown } | { ok: false; status: number; message: string }

export interface ExecutedTool {
  output: string
  isError: boolean
  note: ActionNote | null
  /** Time spent waiting for the owner; not charged to the task's time limit. */
  waitedMs: number
  /** The result carried untrusted external content (taints the rest of the task). */
  untrusted?: boolean
}

export interface AgentDeps {
  provider: TextProviderId
  body: Json
  send: (body: Json) => Promise<SendResult>
  parse: (json: unknown) => { text: string; usage: TextUsage; incomplete: string | null }
  cost: (usage: TextUsage) => number | null
  execute: (call: ToolCall, state: { untrusted: boolean }) => Promise<ExecutedTool>
  budget: RunBudget
  halted: () => boolean
}

export type AgentResult =
  | {
      ok: true
      text: string
      usage: TextUsage
      actions: ActionNote[]
      /** Why the run ended early (a limit), or null. */
      stopped: string | null
      incomplete: string | null
    }
  | { ok: false; code: 'halted' | 'network' | 'api_error'; message: string; usage: TextUsage; actions: ActionNote[] }

export async function runAgent(d: AgentDeps): Promise<AgentResult> {
  const adapter = ADAPTERS[d.provider]
  const usage: TextUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
  const actions: ActionNote[] = []
  let body = d.body
  let lastText = ''
  let untrusted = false

  for (;;) {
    if (d.halted()) return { ok: false, code: 'halted', message: 'Stop all was engaged while Jarvis was working.', usage, actions }
    const stop = d.budget.nextIteration()
    if (stop) return { ok: true, text: lastText, usage, actions, stopped: stop, incomplete: null }

    const res = await d.send(body)
    if (d.halted()) return { ok: false, code: 'halted', message: 'Stop all was engaged while Jarvis was working.', usage, actions }
    if (!res.ok) return { ok: false, code: res.status === 0 ? 'network' : 'api_error', message: res.message, usage, actions }

    const parsed = d.parse(res.value)
    usage.inputTokens += parsed.usage.inputTokens
    usage.outputTokens += parsed.usage.outputTokens
    usage.cachedTokens += parsed.usage.cachedTokens
    d.budget.addCost(d.cost(parsed.usage))
    if (parsed.text) lastText = parsed.text

    const calls = adapter.calls(res.value)
    if (calls.length === 0) {
      return { ok: true, text: parsed.text || lastText, usage, actions, stopped: null, incomplete: parsed.incomplete }
    }

    const results: ToolResult[] = []
    for (const call of calls) {
      // Every call gets a result (both APIs require it), even when it is not run.
      if (d.halted()) {
        results.push({ id: call.id, output: 'Not run: Stop all was engaged.', isError: true })
        continue
      }
      const limit = d.budget.nextToolCall()
      if (limit) {
        results.push({ id: call.id, output: `Not run: ${limit}.`, isError: true })
        continue
      }
      const r = await d.execute(call, { untrusted })
      if (r.untrusted) untrusted = true
      d.budget.excludeWait(r.waitedMs)
      if (r.note) actions.push(r.note)
      results.push({ id: call.id, output: r.output, isError: r.isError })
    }
    body = adapter.append(body, res.value, results)
  }
}
