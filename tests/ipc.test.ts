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
