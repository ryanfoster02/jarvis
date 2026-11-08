import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeSettings, type Settings } from '../shared/ipc.ts'

// Sprint 1: JSON file in userData. Moves to SQLite/Drizzle in Phase 2.
// Never store credentials here — they go to the safeStorage vault (Sprint 3).

let cache: Settings | null = null

const filePath = (): string => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    cache = normalizeSettings(JSON.parse(readFileSync(filePath(), 'utf8')))
  } catch {
    cache = normalizeSettings(undefined) // missing or corrupt → defaults
  }
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = normalizeSettings({ ...loadSettings(), ...patch })
  const path = filePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, path) // atomic replace
  cache = next
  return next
}
