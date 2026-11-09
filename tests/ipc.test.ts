import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  IpcValidationError,
  MAX_CHAT_CHARS,
  isTrustedSenderUrl,
  normalizeSettings,
  validateChatMessage,
  validateReason,
  validateSettingsPatch,
  WORKSPACES,
  DEFAULT_LIMITS,
} from '../src/shared/ipc.ts'

test('settings patch: accepts valid keys', () => {
  assert.deepEqual(validateSettingsPatch({ theme: 'gold' }), { theme: 'gold' })
  assert.deepEqual(validateSettingsPatch({ reducedMotion: true, theme: 'azure' }), { reducedMotion: true, theme: 'azure' })
  assert.deepEqual(validateSettingsPatch({}), {})
})

test('settings patch: rejects bad values, unknown keys, non-objects', () => {
  assert.throws(() => validateSettingsPatch({ theme: 'red' }), IpcValidationError)
  assert.throws(() => validateSettingsPatch({ reducedMotion: 'yes' }), IpcValidationError)
  assert.throws(() => validateSettingsPatch({ apiKey: 'sk-x' }), /unknown setting/)
  assert.throws(() => validateSettingsPatch(null), IpcValidationError)
  assert.throws(() => validateSettingsPatch(['theme']), IpcValidationError)
  assert.throws(() => validateSettingsPatch('theme=gold'), IpcValidationError)
})

test('settings patch: rejects prototype-polluting input', () => {
  const evil = JSON.parse('{"__proto__": {"polluted": true}}')
  assert.throws(() => validateSettingsPatch(evil), /unknown setting/)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('normalizeSettings: falls back to defaults for corrupt data', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings('garbage'), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({ theme: 'nope', reducedMotion: 1 }), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({ theme: 'gold', extra: 1 }), { ...DEFAULT_SETTINGS, theme: 'gold' })
})

test('chat message validation', () => {
  assert.equal(validateChatMessage('  hello  '), 'hello')
  assert.throws(() => validateChatMessage('   '), /empty/)
  assert.throws(() => validateChatMessage(42), IpcValidationError)
  assert.throws(() => validateChatMessage('x'.repeat(MAX_CHAT_CHARS + 1)), /exceeds/)
})

test('kill-switch reason validation', () => {
  assert.equal(validateReason(undefined), 'Manual emergency stop')
  assert.equal(validateReason('  '), 'Manual emergency stop')
  assert.equal(validateReason('x'.repeat(500)).length, 200)
  assert.throws(() => validateReason({}), IpcValidationError)
})

test('sender verification: dev server origin', () => {
  const t = { devServerUrl: 'http://localhost:5173' }
  assert.equal(isTrustedSenderUrl('http://localhost:5173/', t), true)
  assert.equal(isTrustedSenderUrl('http://localhost:5173/#/settings', t), true)
  assert.equal(isTrustedSenderUrl('http://localhost:5174/', t), false)
  assert.equal(isTrustedSenderUrl('https://evil.example/', t), false)
  assert.equal(isTrustedSenderUrl(undefined, t), false)
  assert.equal(isTrustedSenderUrl('not a url', t), false)
})

test('sender verification: packaged file URL must match exactly', () => {
  const t = { rendererFileUrl: 'file:///Applications/JARVIS.app/Contents/Resources/app.asar/out/renderer/index.html' }
  assert.equal(isTrustedSenderUrl(t.rendererFileUrl, t), true)
  assert.equal(isTrustedSenderUrl(t.rendererFileUrl + '#x', t), true)
  assert.equal(isTrustedSenderUrl('file:///tmp/evil.html', t), false)
  assert.equal(isTrustedSenderUrl('http://localhost:5173/', t), false)
})

test('workspace setting: accepts known ids, rejects others', () => {
  for (const w of WORKSPACES) assert.deepEqual(validateSettingsPatch({ activeWorkspace: w.id }), { activeWorkspace: w.id })
  assert.throws(() => validateSettingsPatch({ activeWorkspace: 'Personal' }), /invalid workspace/)
  assert.throws(() => validateSettingsPatch({ activeWorkspace: '../etc' }), /invalid workspace/)
  assert.equal(normalizeSettings({ activeWorkspace: 'nope' }).activeWorkspace, 'personal')
  assert.equal(normalizeSettings({ activeWorkspace: 'research' }).activeWorkspace, 'research')
})

test('workspace ids are unique; default limits forbid recursion', () => {
  assert.equal(new Set(WORKSPACES.map((w) => w.id)).size, WORKSPACES.length)
  assert.equal(DEFAULT_LIMITS.maxSubagentDepth, 1)
  assert.ok(DEFAULT_LIMITS.maxConcurrentAgents <= 2)
  assert.ok(Object.isFrozen(DEFAULT_LIMITS))
})

test('conversation ids, new messages and titles', async () => {
  const { validateConversationId, validateOptionalConversationId, validateNewMessage, titleFrom } = await import('../src/shared/ipc.ts')
  const id = '3f2b8c1e-9d4a-4b6f-8e2a-1c3d5e7f9a0b'
  assert.equal(validateConversationId(id.toUpperCase()), id)
  assert.equal(validateOptionalConversationId(null), null)
  assert.throws(() => validateConversationId("1' OR '1'='1"), IpcValidationError)
  assert.deepEqual(validateNewMessage({ role: 'assistant', text: ' Hello ', via: 'voice' }), { role: 'assistant', text: 'Hello', via: 'voice' })
  assert.throws(() => validateNewMessage({ role: 'system', text: 'x', via: 'text' }), /role/)
  assert.throws(() => validateNewMessage({ role: 'user', text: 'x', via: 'text', conversationId: 'y' }), /unknown field/)
  assert.throws(() => validateNewMessage({ role: 'user', text: '   ', via: 'text' }), /empty/)
  assert.equal(titleFrom('  Remind   me\nabout Acme  '), 'Remind me about Acme')
  assert.equal(titleFrom('x'.repeat(100)).length, 58)
  assert.equal(titleFrom('   '), 'New conversation')
})
