import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'

// Shared by the spec and the warm-up: launch the production build (out/) with a throwaway profile
// (no real settings, keys or .env), and always shut it down — forcefully if it won't quit.

export const root = join(__dirname, '..')

/** Allowed per launch. Launches take 8–45 s on the owner's Mac, more right after a build. */
export const LAUNCH_BUDGET = 60_000

const open = new Set<ElectronApplication>()

export async function launchApp(userData: string, timeout = LAUNCH_BUDGET): Promise<{ app: ElectronApplication; page: Page }> {
  // Load the built renderer from disk (as a packaged app would): drop the dev-server URL.
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string' && e[0] !== 'ELECTRON_RENDERER_URL'),
  )
  env.JARVIS_USER_DATA = userData
  const app = await electron.launch({ args: [root], cwd: root, env, timeout })
  open.add(app)
  app.on('close', () => open.delete(app))
  const page = await app.firstWindow({ timeout })
  await page.waitForLoadState('domcontentloaded', { timeout })
  return { app, page }
}

/** Quit politely; if JARVIS hasn't exited within `graceMs`, kill the process. Never hangs. */
export async function closeApp(app: ElectronApplication, graceMs = 15_000): Promise<void> {
  const proc = app.process()
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    app.close().catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs)
    }),
  ])
  clearTimeout(timer)
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
  open.delete(app)
}

/** After each test: shut down anything a failed or timed-out test left running. */
export async function closeAll(): Promise<void> {
  await Promise.all([...open].map((a) => closeApp(a)))
}
