#!/usr/bin/env node
// Electron 45+ no longer downloads its binary during `npm install` (the package has no
// install script; it ships an `install-electron` bin instead). electron-vite only checks
// node_modules/electron/path.txt and fails with "Electron uninstall" if it's missing.
// This script runs Electron's own installer when the binary is absent. Idempotent.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const pathTxt = join(electronDir, 'path.txt')
const installer = join(electronDir, 'install.js')
// --soft (used by postinstall): report problems but never fail `npm install`; predev retries.
const fail = (code = 1) => process.exit(process.argv.includes('--soft') ? 0 : code)

if (!existsSync(electronDir)) {
  console.error('[ensure-electron] electron is not installed. Run `npm install` first.')
  fail()
}
if (existsSync(pathTxt)) process.exit(0)

if (!existsSync(installer)) {
  console.error('[ensure-electron] node_modules/electron/install.js not found; cannot download Electron.')
  fail()
}

console.log('[ensure-electron] Electron binary not found — downloading it now (one-time, ~100 MB)…')
const result = spawnSync(process.execPath, [installer], { cwd: electronDir, stdio: 'inherit' })

if (result.status !== 0 || !existsSync(pathTxt)) {
  console.error('[ensure-electron] Download failed. Check your internet connection and run `npm run setup:electron` again.')
  fail(result.status || 1)
}
console.log('[ensure-electron] Electron is ready.')
