import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, parseLatestRelease, parseVersion, RELEASES_PAGE } from '../src/shared/updates.ts'
import { DEFAULT_SETTINGS, IpcValidationError, normalizeSettings, validateSettingsPatch } from '../src/shared/ipc.ts'

test('versions: numeric order, v prefix, pre-releases before their release, junk compares equal', () => {
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0)
  assert.ok(compareVersions('v0.10.0', '0.9.0') > 0)
  assert.ok(compareVersions('1.0.0', '1.0.0-beta.1') > 0)
  assert.ok(compareVersions('1.0.0-alpha', '1.0.0-beta') < 0)
  assert.equal(compareVersions('0.1.0', 'v0.1.0'), 0)
  assert.equal(compareVersions('latest', '0.1.0'), 0)
  assert.equal(parseVersion('1.2'), null)
})

test('latest release: only this repository\'s published releases are accepted', () => {
  const good = {
    tag_name: 'v0.2.0',
    name: 'JARVIS 0.2.0',
    html_url: `${RELEASES_PAGE}/tag/v0.2.0`,
    published_at: '2026-11-20T10:00:00Z',
    body: 'Web research, backups.',
    draft: false,
    prerelease: false,
  }
  assert.deepEqual(parseLatestRelease(good), {
    version: '0.2.0',
    name: 'JARVIS 0.2.0',
    url: `${RELEASES_PAGE}/tag/v0.2.0`,
    publishedAt: '2026-11-20T10:00:00Z',
    notes: 'Web research, backups.',
  })
  assert.equal(parseLatestRelease({ ...good, html_url: 'https://evil.example.com/releases/tag/v9.9.9' }), null)
  assert.equal(parseLatestRelease({ ...good, html_url: 'https://github.com/someone-else/jarvis/releases/tag/v0.2.0' }), null)
  assert.equal(parseLatestRelease({ ...good, draft: true }), null)
  assert.equal(parseLatestRelease({ ...good, prerelease: true }), null)
  assert.equal(parseLatestRelease({ ...good, tag_name: 'nightly' }), null)
  assert.equal(parseLatestRelease(null), null)
  assert.equal(parseLatestRelease({ ...good, name: '' })?.name, 'v0.2.0')
})

test('setting: update checks are off by default and validated', () => {
  assert.equal(DEFAULT_SETTINGS.checkForUpdates, false)
  assert.deepEqual(validateSettingsPatch({ checkForUpdates: true }), { checkForUpdates: true })
  assert.throws(() => validateSettingsPatch({ checkForUpdates: 1 }), IpcValidationError)
  assert.equal(normalizeSettings({ checkForUpdates: true }).checkForUpdates, true)
})
