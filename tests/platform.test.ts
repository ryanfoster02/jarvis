import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectPlatform, platformText } from '../src/shared/platform.ts'

test('platform detection from navigator and process values', () => {
  assert.equal(detectPlatform('MacIntel'), 'mac')
  assert.equal(detectPlatform('darwin'), 'mac')
  assert.equal(detectPlatform('Win32'), 'windows')
  assert.equal(detectPlatform('win32'), 'windows')
  assert.equal(detectPlatform('Linux x86_64'), 'linux')
  assert.equal(detectPlatform('linux'), 'linux')
})

test('shortcuts and wording per platform', () => {
  assert.equal(platformText('mac').shortcut('.', true), '⌘⇧.')
  assert.equal(platformText('windows').shortcut(',', false), 'Ctrl+,')
  assert.equal(platformText('linux').shortcut('.', true), 'Ctrl+Shift+.')
  assert.equal(platformText('mac').tray, 'menu bar')
  assert.equal(platformText('windows').tray, 'system tray')
  assert.match(platformText('linux').keychain, /keyring/)
})
