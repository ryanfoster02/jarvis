import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANTHROPIC_VERSION,
  buildAnthropicRequest,
  describeAnthropicError,
  parseAnthropicResponse,
  toAnthropicMessages,
} from '../src/shared/anthropic.ts'
import { buildProviderRequest, estimateTextCostUsd } from '../src/shared/text.ts'
import {
  DEFAULT_SETTINGS,
  IpcValidationError,
  PROVIDERS,
  TEXT_MODELS,
  textModelProvider,
  validateAnthropicKey,
  validateProviderKey,
  validateSettingsPatch,
} from '../src/shared/ipc.ts'
import { detectSecret } from '../src/shared/memory.ts'

test('messages start with the user, alternate, and end with the new message', () => {
  assert.deepEqual(
    toAnthropicMessages(
      [
        { role: 'assistant', text: 'Good evening.' }, // dropped: before the first user turn
        { role: 'user', text: 'Hi' },
        { role: 'user', text: 'Are you there?' }, // merged with the previous user turn
        { role: 'assistant', text: 'Yes.' },
        { role: 'assistant', text: '   ' }, // empty: dropped
      ],
      'What can you do?',
    ),
    [
      { role: 'user', content: 'Hi\n\nAre you there?' },
      { role: 'assistant', content: 'Yes.' },
      { role: 'user', content: 'What can you do?' },
    ],
  )
  // Last stored turn was the user (e.g. a reply failed): merged with the new message, still valid.
  assert.deepEqual(toAnthropicMessages([{ role: 'user', text: 'First try' }], 'Second try'), [
    { role: 'user', content: 'First try\n\nSecond try' },
  ])
})

test('request: system prompt top-level, max_tokens, model', () => {
  const body = buildAnthropicRequest({ model: 'claude-haiku-5-5', instructions: 'You are JARVIS.', history: [], message: 'Hello' })
  assert.deepEqual(body, {
    model: 'claude-haiku-5-5',
    max_tokens: 1200,
    system: 'You are JARVIS.',
    messages: [{ role: 'user', content: 'Hello' }],
  })
  assert.equal(ANTHROPIC_VERSION, '2023-06-01')
})

test('provider routing: Claude models build Anthropic bodies with the same persona + memory', () => {
  const o = {
    workspaceName: 'Foster Automation',
    persona: 'british-butler' as const,
    honorific: 'sir' as const,
    history: [],
    message: 'Morning',
    memories: { global: ['Owner is Ryan'], workspace: [] },
  }
  const claude = buildProviderRequest({ ...o, model: 'claude-sonnet-5-5' })
  assert.equal(typeof claude.system, 'string')
  assert.match(String(claude.system), /Owner is Ryan/)
  assert.match(String(claude.system), /Never pretend/)
  assert.equal('instructions' in claude, false)
  const gpt = buildProviderRequest({ ...o, model: 'gpt-5.4-mini' })
  assert.match(String(gpt.instructions), /Owner is Ryan/)
  assert.equal('system' in gpt, false)
})

test('response parsing: joins text blocks, skips others, full prompt size, stop reasons', () => {
  const r = parseAnthropicResponse({
    content: [
      { type: 'thinking', thinking: '…' },
      { type: 'text', text: 'Certainly. ' },
      { type: 'text', text: 'One moment.' },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 50, output_tokens: 12, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
  })
  assert.deepEqual(r, { text: 'Certainly. One moment.', usage: { inputTokens: 450, outputTokens: 12, cachedTokens: 400 }, incomplete: null })
  assert.equal(parseAnthropicResponse({ content: [{ type: 'text', text: 'Half' }], stop_reason: 'max_tokens' }).incomplete, 'max_tokens')
  assert.equal(parseAnthropicResponse({ content: [], stop_reason: 'refusal' }).incomplete, 'refusal')
  assert.equal(parseAnthropicResponse(null).text, '')
})

test('errors are actionable and never leak keys', () => {
  const e = (type: string, message = '') => JSON.stringify({ type: 'error', error: { type, message } })
  assert.match(describeAnthropicError(401, e('authentication_error', 'invalid x-api-key')), /rejected the API key/)
  assert.match(describeAnthropicError(404, e('not_found_error', 'model: claude-x')), /couldn't find that model/)
  assert.match(describeAnthropicError(429, e('rate_limit_error')), /rate limit/)
  assert.match(describeAnthropicError(529, e('overloaded_error')), /overloaded/)
  assert.match(describeAnthropicError(503, 'oops'), /server error/)
  assert.doesNotMatch(describeAnthropicError(400, e('invalid_request_error', 'bad key sk-ant-api03-SECRETSECRET')), /SECRETSECRET/)
})

test('cost: Claude prices, Haiku prompt-length tiers', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`)
  near(estimateTextCostUsd('claude-sonnet-5-5', { inputTokens: 1000, cachedTokens: 0, outputTokens: 100 }), (1000 * 2 + 100 * 10) / 1e6)
  near(estimateTextCostUsd('claude-opus-5-5', { inputTokens: 1000, cachedTokens: 500, outputTokens: 0 }), (500 * 4 + 500 * 0.2) / 1e6)
  near(estimateTextCostUsd('claude-haiku-5-5', { inputTokens: 2000, cachedTokens: 0, outputTokens: 200 }), (2000 * 0.1 + 200 * 0.5) / 1e6)
  near(estimateTextCostUsd('claude-haiku-5-5', { inputTokens: 150_000, cachedTokens: 0, outputTokens: 200 }), (150_000 * 0.5 + 200 * 2.5) / 1e6)
})

test('models, providers, keys and settings', () => {
  assert.equal(textModelProvider('claude-haiku-5-5'), 'anthropic')
  assert.equal(textModelProvider('gpt-5.4-mini'), 'openai')
  assert.ok(TEXT_MODELS.some((m) => m.provider === 'anthropic'))
  assert.deepEqual([...PROVIDERS], ['openai', 'anthropic', 'elevenlabs', 'github'])
  assert.equal(DEFAULT_SETTINGS.textModel, 'gpt-5.4-mini', 'default unchanged for existing setups')
  assert.deepEqual(validateSettingsPatch({ textModel: 'claude-sonnet-5-5' }), { textModel: 'claude-sonnet-5-5' })
  const key = 'sk-ant-api03-' + 'A1_b-'.repeat(10)
  assert.equal(validateAnthropicKey(` ${key} `), key)
  assert.equal(validateProviderKey('anthropic', key), key)
  assert.throws(() => validateAnthropicKey('sk-proj-' + 'a'.repeat(40)), /Anthropic API key/)
  assert.throws(() => validateProviderKey('openai', key), IpcValidationError, 'OpenAI validator must not accept an Anthropic key')
  assert.ok(detectSecret(`my claude key is ${key}`), 'Anthropic keys are refused by memory too')
})
