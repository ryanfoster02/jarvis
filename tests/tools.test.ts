import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anthropicTools,
  enabledTools,
  openAITools,
  parseToolArgs,
  realtimeTools,
  summarizeToolCall,
  ToolArgsError,
  toolInstructions,
  TOOLS,
  type ToolScope,
} from '../src/shared/tools.ts'
import { decide, isOffered, RunBudget, type PermissionContext } from '../src/shared/permissions.ts'
import {
  DEFAULT_LIMITS,
  DEFAULT_SETTINGS,
  IpcValidationError,
  normalizeSettings,
  TOOL_NAMES,
  validateApprovalId,
  validateSettingsPatch,
  validateToolInvoke,
} from '../src/shared/ipc.ts'
import { buildRealtimeSession, buildInstructions } from '../src/shared/realtime.ts'
import { buildProviderRequest } from '../src/shared/text.ts'

const ALL_SCOPES: ToolScope[] = ['clock', 'memory:read', 'memory:write', 'memory:delete']
const ctx = (o: Partial<PermissionContext> = {}): PermissionContext => ({
  halted: false,
  disabled: [],
  grantedScopes: ALL_SCOPES,
  mandates: [],
  ...o,
})
const ID = '3f2b8a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'

test('registry: every tool has a risk, scope and a strict-mode schema', () => {
  assert.deepEqual(Object.keys(TOOLS).sort(), [...TOOL_NAMES].sort())
  for (const t of Object.values(TOOLS)) {
    assert.ok(['low', 'medium', 'high'].includes(t.risk), t.name)
    const p = t.parameters as { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
    assert.equal(p.type, 'object')
    assert.equal(p.additionalProperties, false, `${t.name}: strict mode needs additionalProperties:false`)
    assert.deepEqual([...p.required].sort(), Object.keys(p.properties).sort(), `${t.name}: strict mode needs every property required`)
  }
  assert.equal(TOOLS.forget_memory.risk, 'high')
  assert.equal(TOOLS.save_memory.risk, 'medium')
  assert.equal(TOOLS.get_time.risk, 'low')
})

test('permissions: precedence kill switch > scope > permission > high-risk ask > mandate', () => {
  const { get_time, save_memory, forget_memory } = TOOLS
  assert.deepEqual(decide(get_time, ctx()), { kind: 'allow', decision: 'auto' })
  assert.equal(decide(save_memory, ctx()).kind, 'ask')
  assert.deepEqual(decide(save_memory, ctx({ mandates: ['memory:write'] })), { kind: 'allow', decision: 'mandate' })
  // High risk always asks — a mandate for its scope changes nothing.
  assert.equal(decide(forget_memory, ctx({ mandates: ALL_SCOPES })).kind, 'ask')
  // Kill switch beats everything, including low risk and mandates.
  for (const t of Object.values(TOOLS)) assert.equal(decide(t, ctx({ halted: true, mandates: ALL_SCOPES })).kind, 'deny')
  // Switched off or out of scope: refused, never merely asked.
  assert.equal(decide(forget_memory, ctx({ disabled: ['forget_memory'] })).kind, 'deny')
  assert.equal(decide(save_memory, ctx({ grantedScopes: ['clock'], mandates: ['memory:write'] })).kind, 'deny')
  assert.equal(isOffered(save_memory, ctx({ disabled: ['save_memory'] })), false)
  assert.equal(isOffered(get_time, ctx()), true)
})

test('arguments: validated strictly, secrets refused before anyone is asked', () => {
  assert.deepEqual(parseToolArgs('get_time', '{}'), {})
  assert.deepEqual(parseToolArgs('get_time', ''), {})
  assert.throws(() => parseToolArgs('get_time', '{"x":1}'), ToolArgsError)
  assert.deepEqual(parseToolArgs('save_memory', '{"text":"  Prefers  tea ","scope":"global"}'), { text: 'Prefers tea', scope: 'global' })
  assert.deepEqual(parseToolArgs('save_memory', { text: 'Likes jazz', scope: 'workspace' }), { text: 'Likes jazz', scope: 'workspace' })
  assert.throws(() => parseToolArgs('save_memory', '{"text":"x","scope":"everywhere"}'), /scope/)
  assert.throws(() => parseToolArgs('save_memory', '{"text":"x","scope":"global","admin":true}'), /Unexpected argument/)
  assert.throws(() => parseToolArgs('save_memory', { text: 'my openai key is sk-proj-abcdefghijklmnopqrstuvwx', scope: 'global' }), /API key/)
  assert.throws(() => parseToolArgs('save_memory', '{"text":'), /valid JSON/)
  assert.throws(() => parseToolArgs('save_memory', '[1]'), /object/)
  assert.deepEqual(parseToolArgs('forget_memory', { id: ID.toUpperCase() }), { id: ID })
  assert.throws(() => parseToolArgs('forget_memory', { id: '../etc' }), /memory ID/)
})

test('summaries are short, readable and show what would be deleted', () => {
  assert.equal(summarizeToolCall('save_memory', { text: 'Likes jazz', scope: 'workspace' }, { workspaceName: 'Personal' }), 'Remember in Personal: "Likes jazz"')
  assert.equal(summarizeToolCall('save_memory', { text: 'Likes jazz', scope: 'global' }), 'Remember everywhere: "Likes jazz"')
  assert.equal(summarizeToolCall('forget_memory', { id: ID }, { memoryText: 'Likes jazz' }), 'Delete memory: "Likes jazz"')
  assert.ok(summarizeToolCall('save_memory', { text: 'a'.repeat(500), scope: 'global' }).length <= 280)
})

test('provider tool formats', () => {
  const specs = enabledTools(['forget_memory'])
  assert.deepEqual(specs.map((t) => t.name), ['get_time', 'list_memories', 'save_memory'])
  const oa = openAITools(specs)[2] as Record<string, unknown>
  assert.equal(oa.type, 'function')
  assert.equal(oa.strict, true)
  assert.equal(oa.name, 'save_memory')
  assert.equal('strict' in (realtimeTools(specs)[0] as object), false)
  const an = anthropicTools(specs)[0] as Record<string, unknown>
  assert.deepEqual(Object.keys(an), ['name', 'description', 'input_schema'])
})

test('requests carry tools; instructions match what is actually available', () => {
  const base = { workspaceName: 'Personal', persona: 'british-butler' as const, honorific: 'none' as const, history: [], message: 'hi' }
  const tools = enabledTools([])
  const gpt = buildProviderRequest({ ...base, model: 'gpt-5.4-mini', tools })
  assert.equal((gpt.tools as unknown[]).length, 4)
  assert.deepEqual(gpt.include, ['reasoning.encrypted_content'], 'store:false + tools: reasoning must be returnable')
  assert.equal('include' in buildProviderRequest({ ...base, model: 'gpt-5.4-mini' }), false)
  const gpt5 = buildProviderRequest({ ...base, model: 'gpt-5-mini', tools })
  assert.deepEqual(gpt5.include, ['reasoning.encrypted_content'])
  const claude = buildProviderRequest({ ...base, model: 'claude-haiku-5-5', tools })
  assert.equal((claude.tools as unknown[]).length, 4)
  assert.equal('tools' in buildProviderRequest({ ...base, model: 'claude-haiku-5-5' }), false)
  const voice = buildRealtimeSession({ model: 'gpt-realtime-2.1-mini', voice: 'ballad', workspaceName: 'Personal', transcription: true, persona: 'neutral', honorific: 'none', output: 'text', tools })
  assert.equal(voice.tool_choice, 'auto')
  assert.equal((voice.tools as unknown[]).length, 4)
  assert.equal('tools' in buildRealtimeSession({ model: 'gpt-realtime-2.1-mini', voice: 'ballad', workspaceName: 'P', transcription: true, persona: 'neutral', honorific: 'none', output: 'audio' }), false)

  const withTools = buildInstructions({ workspaceName: 'P', persona: 'neutral', honorific: 'none', tools })
  assert.match(withTools, /save_memory: only for facts/)
  assert.match(withTools, /Only say an action happened if the tool result confirms it/)
  assert.ok(withTools.indexOf('# Tools') < withTools.indexOf('# Limits'))
  const noSave = toolInstructions(enabledTools(['save_memory']))
  assert.match(noSave.join('\n'), /Saving memories is switched off/)
})

test('run budget: steps, actions, time (minus approval waits) and spend', () => {
  let now = 0
  const b = new RunBudget({ ...DEFAULT_LIMITS, maxIterations: 2, maxToolCalls: 1, maxSeconds: 10, maxCostUsd: 0.5 }, () => now)
  assert.equal(b.nextIteration(), null)
  assert.equal(b.nextToolCall(), null)
  assert.match(b.nextToolCall() ?? '', /1 actions/)
  assert.equal(b.nextIteration(), null)
  assert.match(b.nextIteration() ?? '', /2 steps/)

  const t = new RunBudget(DEFAULT_LIMITS, () => now)
  now = 150_000
  t.excludeWait(60_000) // owner took a minute to approve
  assert.equal(t.overTimeOrCost(), null)
  now = 200_000
  assert.match(t.overTimeOrCost() ?? '', /seconds/)

  const c = new RunBudget(DEFAULT_LIMITS, () => 0)
  c.addCost(0.6)
  c.addCost(null)
  c.addCost(0.6)
  assert.match(c.overTimeOrCost() ?? '', /spend limit/)
})

test('settings: permissions and mandate are validated; defaults ask before saving', () => {
  assert.deepEqual(DEFAULT_SETTINGS.disabledTools, [])
  assert.equal(DEFAULT_SETTINGS.autoSaveMemories, false)
  assert.deepEqual(validateSettingsPatch({ disabledTools: ['save_memory', 'save_memory'] }), { disabledTools: ['save_memory'] })
  assert.throws(() => validateSettingsPatch({ disabledTools: ['rm_rf'] }), IpcValidationError)
  assert.throws(() => validateSettingsPatch({ disabledTools: 'save_memory' }), IpcValidationError)
  assert.throws(() => validateSettingsPatch({ autoSaveMemories: 'yes' }), IpcValidationError)
  assert.deepEqual(normalizeSettings({ disabledTools: ['get_time', 'bogus'], autoSaveMemories: true }).disabledTools, ['get_time'])
  assert.deepEqual(validateToolInvoke('get_time', '{}'), { name: 'get_time', args: '{}' })
  assert.throws(() => validateToolInvoke('exec', '{}'), IpcValidationError)
  assert.throws(() => validateToolInvoke('get_time', { a: 1 }), IpcValidationError)
  assert.throws(() => validateToolInvoke('get_time', 'x'.repeat(5000)), IpcValidationError)
  assert.equal(validateApprovalId(ID.toUpperCase()), ID)
  assert.throws(() => validateApprovalId('nope'), IpcValidationError)
})

test('action wording for the conversation view', async () => {
  const { describeAction } = await import('../src/shared/tools.ts')
  assert.equal(describeAction({ title: 'Save a memory', decision: 'approved', outcome: 'ok', detail: 'Likes jazz' }), 'Save a memory · You approved · Likes jazz')
  assert.equal(describeAction({ title: 'Save a memory', decision: 'denied', outcome: 'skipped', detail: 'You declined' }), 'Save a memory · Not done (you declined)')
  assert.equal(describeAction({ title: 'Delete a memory', decision: 'approved', outcome: 'error', detail: 'No memory with that ID' }), 'Delete a memory · Failed · No memory with that ID')
  assert.equal(describeAction({ title: 'Check the time', decision: 'auto', outcome: 'ok', detail: '' }), 'Check the time · Low risk, ran automatically')
})
