import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, launchApp } from './electron'

// Warm-up: launch the fresh build once before the tests. The first start after a build is the slow
// one (macOS checks the new files), so it happens here, with a generous limit, not inside test 1.
export default async function globalSetup(): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), 'jarvis-e2e-warmup-'))
  const started = Date.now()
  try {
    const { app } = await launchApp(profile, 180_000)
    await closeApp(app)
    console.log(`Warm-up launch: ${((Date.now() - started) / 1000).toFixed(1)} s`)
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}
