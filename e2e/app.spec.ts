import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Launches the production build (out/) with a throwaway profile: no real settings, keys or .env.
const root = join(__dirname, '..')

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  // Load the built renderer from disk (as a packaged app would): drop the dev-server URL.
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string' && e[0] !== 'ELECTRON_RENDERER_URL'),
  )
  env.JARVIS_USER_DATA = userData
  const app = await electron.launch({ args: [root], cwd: root, env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.wordmark')).toHaveText('JARVIS')
  return { app, page }
}

let profile: string
test.beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'))
})
test.afterEach(() => {
  rmSync(profile, { recursive: true, force: true })
})

test('launches to the dashboard in the standing-by state', async () => {
  const { app, page } = await launch(profile)
  await expect(page).toHaveTitle('J.A.R.V.I.S.')
  await expect(page.locator('.core-state')).toHaveText('STANDING BY')
  await expect(page.getByRole('heading', { name: 'Conversation' })).toBeVisible()
  await app.close()
})

test('renderer is isolated: no Node globals, only the narrow jarvis bridge', async () => {
  const { app, page } = await launch(profile)
  const globals = await page.evaluate(() => {
    const g = globalThis as unknown as Record<string, unknown>
    return {
      require: typeof g.require,
      process: typeof g.process,
      module: typeof g.module,
      bridge: Object.keys(g.jarvis as object).sort(),
    }
  })
  expect(globals.require).toBe('undefined')
  expect(globals.process).toBe('undefined')
  expect(globals.module).toBe('undefined')
  expect(globals.bridge).toEqual(['app', 'chat', 'credentials', 'killSwitch', 'settings', 'tts', 'voice'])

  // getLastWebPreferences() exists at runtime but is missing from Electron's TypeScript definitions,
  // so it's reached through a narrow cast. If Electron ever removes it, this test fails loudly.
  const prefs = await app.evaluate(({ BrowserWindow }: typeof import('electron')) => {
    type Prefs = { contextIsolation?: boolean; sandbox?: boolean; nodeIntegration?: boolean; webviewTag?: boolean }
    const wc = BrowserWindow.getAllWindows()[0]?.webContents as unknown as { getLastWebPreferences?: () => Prefs | null } | undefined
    if (typeof wc?.getLastWebPreferences !== 'function') return 'getLastWebPreferences unavailable'
    const p = wc.getLastWebPreferences()
    return { contextIsolation: p?.contextIsolation, sandbox: p?.sandbox, nodeIntegration: p?.nodeIntegration, webviewTag: p?.webviewTag }
  })
  expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false })
  await app.close()
})

test('production page carries a strict Content-Security-Policy', async () => {
  const { app, page } = await launch(profile)
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toContain("'unsafe-eval'")
  await app.close()
})

test('navigation away and new windows are blocked', async () => {
  const { app, page } = await launch(profile)
  const before = page.url()
  // http (not https) so the blocked navigation doesn't open your browser during the test
  await page.evaluate(() => {
    window.location.href = 'http://example.com/'
  })
  await page.waitForTimeout(800)
  expect(page.url()).toBe(before)
  const opened = await page.evaluate(() => window.open('http://example.com/') === null)
  expect(opened).toBe(true)
  expect(app.windows()).toHaveLength(1)
  await app.close()
})

test('theme choice survives a restart', async () => {
  let { app, page } = await launch(profile)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'gold')
  await page.getByRole('button', { name: /^Theme:/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'azure')
  await app.close()
  ;({ app, page } = await launch(profile))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'azure')
  await app.close()
})

test('Stop all halts everything and Re-arm restores it', async () => {
  const { app, page } = await launch(profile)
  await page.getByRole('button', { name: 'Stop all' }).click()
  await expect(page.locator('.core-state')).toHaveText('STOPPED')
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  await page.getByRole('button', { name: 'Re-arm' }).click()
  await expect(page.locator('.core-state')).toHaveText('STANDING BY')
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  await app.close()
})

test('typing without a key gives an honest notice, not a fake reply', async () => {
  const { app, page } = await launch(profile)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('Jarvis, what is on my schedule?')
  await box.press('Enter')
  await expect(page.locator('.msg-system')).toContainText('No AI provider is connected yet')
  await expect(page.locator('.msg-assistant')).toHaveCount(0)
  await app.close()
})

test('settings open with ⌘, and close with Esc; bad key is rejected before any network call', async () => {
  const { app, page } = await launch(profile)
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'AI provider' }).click()
  const openai = page.locator('.provider').filter({ hasText: 'OpenAI' })
  await openai.locator('input[type="password"]').fill('not-a-real-key')
  await openai.getByRole('button', { name: 'Verify and save' }).click()
  await expect(openai.locator('.form-msg.is-error')).toContainText("doesn't look like an OpenAI API key")
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Conversation' })).toBeVisible()
  await app.close()
})

test('conversations persist across restarts, stay in their workspace, and delete cleanly', async () => {
  let { app, page } = await launch(profile)
  // Store a turn through the same bridge voice transcripts use (typed replies need a real API key).
  const saved = await page.evaluate(async () => {
    const j = (window as unknown as { jarvis: { conversations: { append: (id: string | null, m: object) => Promise<{ ok: boolean }> } } }).jarvis
    return (await j.conversations.append(null, { role: 'user', text: 'Remember the Acme follow-up', via: 'voice' })).ok
  })
  expect(saved).toBe(true)
  await app.close()

  ;({ app, page } = await launch(profile))
  const picker = page.getByRole('combobox', { name: 'Conversation' })
  await expect(picker.locator('option', { hasText: 'Remember the Acme follow-up' })).toHaveCount(1)
  await expect(page.locator('.msg-user')).toContainText('Remember the Acme follow-up')

  // Another workspace sees none of it.
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption('research')
  await expect(page.locator('.msg-user')).toHaveCount(0)
  await expect(picker.locator('option')).toHaveCount(1) // only "New conversation"

  // Back to Personal, delete with confirmation.
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption('personal')
  await expect(page.locator('.msg-user')).toContainText('Remember the Acme follow-up')
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.msg-user')).toHaveCount(0)
  await app.close()

  ;({ app, page } = await launch(profile))
  await expect(page.getByRole('combobox', { name: 'Conversation' }).locator('option')).toHaveCount(1)
  await app.close()
})
