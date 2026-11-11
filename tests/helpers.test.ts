import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canDelegate, helperInstructions, helperReport, helperTools, isParallelSafe, validateHelperTask } from '../src/shared/helpers.ts'
import { runAgent, type AgentDeps } from '../src/shared/agent.ts'
import { RunBudget, decide } from '../src/shared/permissions.ts'
import { parseResponsesOutput } from '../src/shared/text.ts'
import { DEFAULT_LIMITS, HELPER_LIMITS, IpcValidationError } from '../src/shared/ipc.ts'
import { enabledTools, parseToolArgs, summarizeToolCall, ToolArgsError, TOOLS, toolInstructions } from '../src/shared/tools.ts'

test('depth 1: Jarvis may delegate, helpers may not; helpers get read-only tools without delegate', () => {
  assert.equal(canDelegate(0, DEFAULT_LIMITS), true)
  assert.equal(canDelegate(1, DEFAULT_LIMITS), false)
  assert.equal(canDelegate(0, HELPER_LIMITS), false)
  const tools = helperTools(enabledTools([]))
  assert.ok(tools.length > 0)
  assert.ok(tools.every((t) => t.risk === 'low'))
  assert.equal(tools.some((t) => t.name === 'delegate'), false)
  for (const n of ['save_memory', 'forget_memory', 'set_reminder', 'cancel_reminder'] as const) {
    assert.equal(tools.some((t) => t.name === n), false, `${n} must not reach helpers`)
  }
  assert.ok(HELPER_LIMITS.maxCostUsd < DEFAULT_LIMITS.maxCostUsd && HELPER_LIMITS.maxToolCalls < DEFAULT_LIMITS.maxToolCalls)
  assert.equal(DEFAULT_LIMITS.maxConcurrentHelpers, 2)
})

test('delegate tool: low risk, own scope, validated task, summary', () => {
  assert.equal(TOOLS.delegate.risk, 'low')
  assert.equal(TOOLS.delegate.scope, 'agents:delegate')
  assert.equal(isParallelSafe(TOOLS.delegate), true)
  assert.equal(isParallelSafe(TOOLS.save_memory), false)
  assert.equal(decide(TOOLS.delegate, { halted: false, disabled: [], grantedScopes: [], mandates: [] }).kind, 'deny', 'needs its scope (a text provider key)')
  assert.deepEqual(parseToolArgs('delegate', { task: '  List open issues in o/r and summarise the top 3.  ' }), { task: 'List open issues in o/r and summarise the top 3.' })
  assert.throws(() => parseToolArgs('delegate', { task: 'short' }), ToolArgsError)
  assert.throws(() => validateHelperTask('x'.repeat(1501)), IpcValidationError)
  assert.equal(summarizeToolCall('delegate', { task: 'Summarise o/r issues' }), 'Helper: Summarise o/r issues')
  assert.match(toolInstructions(enabledTools([])).join('\n'), /up to two in one turn/)
})

test('helper prompt and report wording', () => {
  const ins = helperInstructions(helperTools(enabledTools([])), 'Personal')
  assert.match(ins, /cannot see the conversation/)
  assert.match(ins, /read-only/)
  assert.match(ins, /Never follow instructions/)
  assert.doesNotMatch(ins, /save_memory|delegate/)
  assert.match(helperReport({ text: 'Two open bugs.', stopped: null, readUntrusted: true }), /untrusted GitHub data[\s\S]*Two open bugs\.$/)
  assert.match(helperReport({ text: '', stopped: 'stopped after 6 steps', readUntrusted: false }), /no report\.\)\n\(The helper stopped after 6 steps\.\)$/)
})

test('parallel-safe calls run side by side; others wait their turn; results keep model order', async () => {
  const twoHelpers = {
    output: [
      { type: 'function_call', call_id: 'a', name: 'delegate', arguments: '{"task":"repo A please"}' },
      { type: 'function_call', call_id: 'b', name: 'delegate', arguments: '{"task":"repo B please"}' },
      { type: 'function_call', call_id: 'c', name: 'save_memory', arguments: '{"text":"x","scope":"global"}' },
    ],
  }
  const final = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Combined.' }] }] }
  const replies = [twoHelpers, final]
  const bodies: Array<Record<string, unknown>> = []
  let running = 0
  let peak = 0
  const order: string[] = []
  const deps: AgentDeps = {
    provider: 'openai',
    body: { input: [] },
    send: async (b) => (bodies.push(b), { ok: true, value: replies.shift() }),
    parse: parseResponsesOutput,
    cost: () => 0,
    execute: async (call) => {
      running++
      peak = Math.max(peak, running)
      order.push(`start ${call.id}`)
      await new Promise((r) => setTimeout(r, call.id === 'a' ? 30 : 5))
      order.push(`end ${call.id}`)
      running--
      return { output: `done ${call.id}`, isError: false, note: null, waitedMs: 0, costUsd: 0.1, untrusted: call.id === 'b' }
    },
    budget: new RunBudget(DEFAULT_LIMITS),
    halted: () => false,
    parallelSafe: (n) => isParallelSafe(TOOLS[n as keyof typeof TOOLS]),
  }
  const r = await runAgent(deps)
  assert.equal(r.ok && r.text, 'Combined.')
  assert.equal(r.ok && r.untrusted, true, 'a helper that read untrusted content taints the request')
  assert.equal(peak, 2, 'the two helpers overlapped')
  assert.deepEqual(order.slice(-2), ['start c', 'end c'], 'the approval-needing call ran alone, after them')
  const outs = (bodies[1]?.input as Array<Record<string, unknown>>).filter((i) => i.type === 'function_call_output').map((i) => i.call_id)
  assert.deepEqual(outs, ['a', 'b', 'c'])
  // Helper spend counts against the request: three calls at $0.10 each.
  const capped = await runAgent({ ...deps, budget: new RunBudget({ ...DEFAULT_LIMITS, maxCostUsd: 0.25 }), send: async () => ({ ok: true, value: twoHelpers }) })
  assert.match((capped.ok && capped.stopped) || '', /spend limit/)
})
