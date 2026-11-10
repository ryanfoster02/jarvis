import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAgent, appendAnthropicResults, appendOpenAIResults, openAIToolCalls, anthropicToolCalls, type AgentDeps, type ToolCall } from '../src/shared/agent.ts'
import { RunBudget } from '../src/shared/permissions.ts'
import { parseResponsesOutput } from '../src/shared/text.ts'
import { parseAnthropicResponse } from '../src/shared/anthropic.ts'
import { DEFAULT_LIMITS, type ActionNote } from '../src/shared/ipc.ts'

const note = (detail: string): ActionNote => ({ tool: 'save_memory', title: 'Save a memory', decision: 'approved', outcome: 'ok', detail })

// OpenAI: reasoning + function_call, then a final message.
const oaCall = {
  output: [
    { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque' },
    { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'save_memory', arguments: '{"text":"Likes jazz","scope":"global"}' },
  ],
  usage: { input_tokens: 100, output_tokens: 20 },
}
const oaFinal = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }], usage: { input_tokens: 150, output_tokens: 5 } }

function deps(o: Partial<AgentDeps> & Pick<AgentDeps, 'provider' | 'send'>): AgentDeps {
  return {
    body: o.provider === 'openai' ? { model: 'gpt-5-mini', input: [{ role: 'user', content: 'remember I like jazz' }] } : { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'remember I like jazz' }] },
    parse: o.provider === 'openai' ? parseResponsesOutput : parseAnthropicResponse,
    cost: () => 0.001,
    execute: async () => ({ output: 'Saved.', isError: false, note: note('ok'), waitedMs: 0 }),
    budget: new RunBudget(DEFAULT_LIMITS),
    halted: () => false,
    ...o,
  }
}

test('OpenAI: tool call → result → final answer; reasoning passed back verbatim', async () => {
  const sent: Array<Record<string, unknown>> = []
  const replies = [oaCall, oaFinal]
  const calls: ToolCall[] = []
  const r = await runAgent(
    deps({
      provider: 'openai',
      send: async (b) => (sent.push(b), { ok: true, value: replies.shift() }),
      execute: async (c) => (calls.push(c), { output: 'Saved to memory.', isError: false, note: note('saved'), waitedMs: 0 }),
    }),
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.text, 'Noted.')
  assert.deepEqual(r.usage, { inputTokens: 250, outputTokens: 25, cachedTokens: 0 })
  assert.equal(r.actions.length, 1)
  assert.deepEqual(calls, [{ id: 'call_1', name: 'save_memory', arguments: '{"text":"Likes jazz","scope":"global"}' }])
  const second = sent[1]?.input as unknown[]
  assert.deepEqual(second.slice(1), [...oaCall.output, { type: 'function_call_output', call_id: 'call_1', output: 'Saved to memory.' }])
})

test('Anthropic: tool_use → tool_result first in the next user turn', async () => {
  const sent: Array<Record<string, unknown>> = []
  const replies = [
    { content: [{ type: 'text', text: 'One moment.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_time', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } },
    { content: [{ type: 'text', text: 'It is 7pm.' }], stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 5 } },
  ]
  const r = await runAgent(
    deps({
      provider: 'anthropic',
      send: async (b) => (sent.push(b), { ok: true, value: replies.shift() }),
      execute: async () => ({ output: 'denied by owner', isError: true, note: null, waitedMs: 0 }),
    }),
  )
  assert.equal(r.ok && r.text, 'It is 7pm.')
  const msgs = sent[1]?.messages as Array<{ role: string; content: unknown }>
  assert.equal(msgs.length, 3)
  assert.equal(msgs[1]?.role, 'assistant')
  assert.deepEqual(msgs[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'denied by owner', is_error: true }] })
})

test('limits stop runaway loops and still answer every call', async () => {
  // Model keeps calling tools forever.
  const r = await runAgent(
    deps({
      provider: 'openai',
      budget: new RunBudget({ ...DEFAULT_LIMITS, maxIterations: 3, maxToolCalls: 2 }),
      send: async () => ({ ok: true, value: oaCall }),
    }),
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.match(r.stopped ?? '', /3 steps/)
  assert.equal(r.actions.length, 2, 'third call refused by the action limit')

  // Spend limit
  const spend = await runAgent(deps({ provider: 'openai', cost: () => 2, send: async () => ({ ok: true, value: oaCall }) }))
  assert.match((spend.ok && spend.stopped) || '', /spend limit/)

  // Over-limit call still gets a result in the next request (both APIs require one per call).
  const sent: Array<Record<string, unknown>> = []
  const two = { output: [oaCall.output[1], { ...oaCall.output[1], call_id: 'call_2' }] }
  const replies = [two, oaFinal]
  await runAgent(
    deps({
      provider: 'openai',
      budget: new RunBudget({ ...DEFAULT_LIMITS, maxToolCalls: 1 }),
      send: async (b) => (sent.push(b), { ok: true, value: replies.shift() }),
    }),
  )
  const outs = (sent[1]?.input as Array<Record<string, unknown>>).filter((i) => i.type === 'function_call_output')
  assert.equal(outs.length, 2)
  assert.match(String(outs[1]?.output), /^Not run: stopped after 1 actions/)
})

test('kill switch: stops between steps and refuses pending calls', async () => {
  let halted = false
  let executed = 0
  const r = await runAgent(
    deps({
      provider: 'openai',
      send: async () => ((halted = true), { ok: true, value: oaCall }),
      execute: async () => (executed++, { output: '', isError: false, note: null, waitedMs: 0 }),
      halted: () => halted,
    }),
  )
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.code, 'halted')
  assert.equal(executed, 0)
})

test('API errors pass through; adapters ignore malformed items', async () => {
  const r = await runAgent(deps({ provider: 'anthropic', send: async () => ({ ok: false, status: 529, message: 'overloaded' }) }))
  assert.deepEqual(!r.ok && [r.code, r.message], ['api_error', 'overloaded'])
  const n = await runAgent(deps({ provider: 'openai', send: async () => ({ ok: false, status: 0, message: 'offline' }) }))
  assert.equal(!n.ok && n.code, 'network')
  assert.deepEqual(openAIToolCalls({ output: [{ type: 'function_call', name: 'x' }, null, 'junk'] }), [])
  assert.deepEqual(anthropicToolCalls({ content: [{ type: 'tool_use', name: 'x' }] }), [])
  assert.deepEqual(openAIToolCalls(null), [])
  // Append helpers never mutate the original body.
  const body = { input: [1] }
  appendOpenAIResults(body, oaCall, [])
  assert.deepEqual(body, { input: [1] })
  // Reasoning without encrypted content is dropped (unresolvable under store:false).
  const next = appendOpenAIResults({ input: [] }, { output: [{ type: 'reasoning', id: 'rs_x' }, oaCall.output[1]] }, [])
  assert.deepEqual((next.input as Array<{ type: string }>).map((i) => i.type), ['function_call'])
  const ab = { messages: [] as unknown[] }
  appendAnthropicResults(ab, { content: [] }, [])
  assert.deepEqual(ab, { messages: [] })
})
