import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAll, closeApp, launchApp, LAUNCH_BUDGET } from './electron'

// Launches the production build (out/) with a throwaway profile: no real settings, keys or .env.
// Shared launch/shutdown helpers and the warm-up launch live in e2e/electron.ts and e2e/global-setup.ts.

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launchApp(userData)
  await expect(page.locator('.wordmark')).toHaveText('JARVIS', { timeout: 15_000 })
  return { app, page }
}

let profile: string
test.beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'))
})
test.afterEach(async () => {
  // A test that failed or timed out may have left JARVIS running: shut it down (force if needed)
  // so the next test starts clean and Playwright's teardown never hangs.
  await closeAll()
  rmSync(profile, { recursive: true, force: true })
})

test('launches to the dashboard in the standing-by state', async () => {
  const { app, page } = await launch(profile)
  await expect(page).toHaveTitle('J.A.R.V.I.S.')
  await expect(page.locator('.core-state')).toHaveText('STANDING BY')
  await expect(page.getByRole('heading', { name: 'Conversation' })).toBeVisible()
  await closeApp(app)
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
  expect(globals.bridge).toEqual([
    'app',
    'approvals',
    'background',
    'chat',
    'conversations',
    'credentials',
    'github',
    'killSwitch',
    'memory',
    'reminders',
    'settings',
    'tasks',
    'tools',
    'tts',
    'voice',
    'workflows',
  ])

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
  await closeApp(app)
})

test('production page carries a strict Content-Security-Policy', async () => {
  const { app, page } = await launch(profile)
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toContain("'unsafe-eval'")
  await closeApp(app)
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
  await closeApp(app)
})

test('theme choice survives a restart', async () => {
  test.setTimeout(2 * LAUNCH_BUDGET + 30_000) // two launches
  let { app, page } = await launch(profile)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'gold')
  await page.getByRole('button', { name: /^Theme:/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'azure')
  await closeApp(app)
  ;({ app, page } = await launch(profile))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'azure')
  await closeApp(app)
})

test('Stop all halts everything and Re-arm restores it', async () => {
  const { app, page } = await launch(profile)
  await page.getByRole('button', { name: 'Stop all' }).click()
  await expect(page.locator('.core-state')).toHaveText('STOPPED')
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  await page.getByRole('button', { name: 'Re-arm' }).click()
  await expect(page.locator('.core-state')).toHaveText('STANDING BY')
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  await closeApp(app)
})

test('typing without a key gives an honest notice, not a fake reply', async () => {
  const { app, page } = await launch(profile)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('Jarvis, what is on my schedule?')
  await box.press('Enter')
  await expect(page.locator('.msg-system')).toContainText('No AI provider is connected yet')
  await expect(page.locator('.msg-assistant')).toHaveCount(0)
  await closeApp(app)
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
  await closeApp(app)
})

test('Claude for typed replies: key form validates, missing key is reported honestly', async () => {
  const { app, page } = await launch(profile)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: 'Voice' }).click()
  await page.getByRole('combobox', { name: 'Typed replies model' }).selectOption('claude-haiku-5-5')
  await expect(page.locator('.field-warn')).toContainText('No Anthropic Claude key is saved')

  await page.getByRole('button', { name: 'AI provider' }).click()
  const anthropic = page.locator('.provider').filter({ hasText: 'Anthropic (Claude)' })
  await anthropic.locator('input[type="password"]').fill('sk-proj-' + 'a'.repeat(40))
  await anthropic.getByRole('button', { name: 'Verify and save' }).click()
  await expect(anthropic.locator('.form-msg.is-error')).toContainText("doesn't look like an Anthropic API key")

  await page.keyboard.press('Escape')
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('Jarvis, are you there?')
  await box.press('Enter')
  await expect(page.locator('.msg-system')).toContainText('no Anthropic key is saved')
  await expect(page.locator('.msg-assistant')).toHaveCount(0)
  // Leave the shared test profile as it was.
  await page.evaluate(async () => {
    const j = (window as unknown as { jarvis: { settings: { update: (patch: { textModel: string }) => Promise<unknown> } } }).jarvis
    await j.settings.update({ textModel: 'gpt-5.4-mini' })
  })
  await closeApp(app)
})

test('conversations persist across restarts, stay in their workspace, and delete cleanly', async () => {
  test.setTimeout(3 * LAUNCH_BUDGET + 30_000) // three launches
  let { app, page } = await launch(profile)
  // Store a turn through the same bridge voice transcripts use (typed replies need a real API key).
  const saved = await page.evaluate(async () => {
    const j = (window as unknown as { jarvis: { conversations: { append: (id: string | null, m: object) => Promise<{ ok: boolean }> } } }).jarvis
    return (await j.conversations.append(null, { role: 'user', text: 'Remember the Acme follow-up', via: 'voice' })).ok
  })
  expect(saved).toBe(true)
  await closeApp(app)

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
  await closeApp(app)

  ;({ app, page } = await launch(profile))
  await expect(page.getByRole('combobox', { name: 'Conversation' }).locator('option')).toHaveCount(1)
  await closeApp(app)
})

test('memory: add, scope to workspace, refuse secrets, edit, delete, /remember', async () => {
  test.setTimeout(2 * LAUNCH_BUDGET + 60_000) // two launches plus many steps
  let { app, page } = await launch(profile)
  await page.getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Memory', level: 1 })).toBeVisible()

  const box = page.getByRole('textbox', { name: 'New memory' })
  // Credentials are refused.
  await box.fill('My password is hunter2')
  await page.getByRole('button', { name: 'Remember', exact: true }).click()
  await expect(page.locator('.form-msg.is-error')).toContainText('never stores credentials')

  // A workspace fact and a global fact.
  await box.fill('Acme renews in March')
  await page.getByRole('button', { name: 'Remember', exact: true }).click()
  await expect(page.locator('.memory-text', { hasText: 'Acme renews in March' })).toBeVisible()
  await box.fill('Owner prefers mornings')
  await page.getByRole('combobox').filter({ hasText: 'All workspaces' }).selectOption('global')
  await page.getByRole('button', { name: 'Remember', exact: true }).click()
  await expect(page.locator('.memory-text', { hasText: 'Owner prefers mornings' })).toBeVisible()

  // Survives restart; workspace fact hidden from another workspace, global fact visible.
  await closeApp(app)
  ;({ app, page } = await launch(profile))
  await page.getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(page.locator('.memory-text', { hasText: 'Acme renews in March' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption('research')
  await expect(page.locator('.memory-text', { hasText: 'Acme renews in March' })).toHaveCount(0)
  await expect(page.locator('.memory-text', { hasText: 'Owner prefers mornings' })).toBeVisible()

  // Edit the global fact, then delete it with confirmation.
  // Once editing starts the item's text becomes a textbox, so it no longer matches a text filter:
  // target the open editor instead.
  await page.locator('.memory-item', { hasText: 'Owner prefers mornings' }).getByRole('button', { name: 'Edit' }).click()
  const editor = page.locator('.memory-item:has(.memory-edit)')
  await editor.getByRole('textbox', { name: 'Edit memory' }).fill('Owner prefers early mornings')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.memory-text', { hasText: 'Owner prefers early mornings' })).toBeVisible()
  const edited = page.locator('.memory-item', { hasText: 'Owner prefers early mornings' })
  await edited.getByRole('button', { name: 'Delete' }).click()
  await edited.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.memory-text', { hasText: 'early mornings' })).toHaveCount(0)

  // /remember from the conversation saves to this workspace and isn't sent to the model.
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  const msg = page.getByRole('textbox', { name: 'Message' })
  await msg.fill('/remember Track agent benchmark papers')
  await msg.press('Enter')
  await expect(page.locator('.msg-system')).toContainText('Remembered for this workspace')
  await page.getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(page.locator('.memory-text', { hasText: 'Track agent benchmark papers' })).toBeVisible()
  await closeApp(app)
})

// Sprint 8: drives tool calls through the same bridge a live voice session uses (no API key needed),
// so the permission engine, approvals queue, kill switch and action log are tested for real.
type ToolBridge = {
  tools: { invoke: (name: string, args: string) => Promise<{ ok: boolean; output?: string; message?: string }> }
  memory: { list: () => Promise<{ ok: boolean; value?: Array<{ id: string; text: string }> }> }
}
const invoke = (page: Page, name: string, args: object) =>
  page.evaluate(
    ([n, a]: readonly [string, string]) => (window as unknown as { jarvis: ToolBridge }).jarvis.tools.invoke(n, a),
    [name, JSON.stringify(args)] as const,
  )

test('tools: low risk runs, medium asks, high always asks, secrets refused, Stop all answers no', async () => {
  test.setTimeout(LAUNCH_BUDGET + 60_000)
  const { app, page } = await launch(profile)
  const fact = 'Prefers tea in the afternoon'

  const time = await invoke(page, 'get_time', {})
  expect(time.ok).toBe(true)
  expect(time.output).toContain('timeZone')

  // Medium risk: waits for the owner.
  const saving = invoke(page, 'save_memory', { text: fact, scope: 'workspace' })
  const card = page.locator('.approval').filter({ hasText: fact })
  await expect(card).toBeVisible()
  await expect(card.locator('.risk-badge')).toHaveText('Medium risk')
  await expect(page.locator('.chip-approval')).toHaveText('1 approval waiting')
  await card.getByRole('button', { name: 'Approve' }).click()
  expect((await saving).output).toContain('Saved')
  await expect(page.locator('.approval')).toHaveCount(0)
  await expect(page.locator('.run-summary', { hasText: fact })).toBeVisible()

  // High risk: asks even though it's only a memory; the owner says no.
  const listed: Awaited<ReturnType<ToolBridge['memory']['list']>> = await page.evaluate(() =>
    (window as unknown as { jarvis: ToolBridge }).jarvis.memory.list(),
  )
  const id = listed.value?.find((m) => m.text === fact)?.id ?? ''
  expect(id).not.toBe('')
  const deleting = invoke(page, 'forget_memory', { id })
  const del = page.locator('.approval').filter({ hasText: `Delete memory: "${fact}"` })
  await expect(del.locator('.risk-badge')).toHaveText('High risk')
  await del.getByRole('button', { name: 'Deny' }).click()
  expect((await deleting).output).toContain('declined')
  await expect(page.locator('.run-decision').first()).toContainText('You declined')

  // Secrets never reach an approval.
  const secret = await invoke(page, 'save_memory', { text: 'my api key is sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa', scope: 'global' })
  expect(secret.output).toMatch(/^Not run: .*API key/)
  await expect(page.locator('.approval')).toHaveCount(0)

  // Stop all answers a waiting request with "no".
  const waiting = invoke(page, 'save_memory', { text: 'Should never be saved', scope: 'workspace' })
  await expect(page.locator('.approval')).toHaveCount(1)
  await page.getByRole('button', { name: 'Stop all' }).click()
  expect((await waiting).output).toContain('Stop all')
  await expect(page.locator('.approval')).toHaveCount(0)
  await page.getByRole('button', { name: 'Re-arm' }).click()

  // A switched-off tool is refused outright, never asked about.
  await page.evaluate(() => (window as unknown as { jarvis: { settings: { update: (p: object) => Promise<unknown> } } }).jarvis.settings.update({ disabledTools: ['forget_memory'] }))
  expect((await invoke(page, 'forget_memory', { id })).output).toContain('switched this tool off')
  await expect(page.locator('.approval')).toHaveCount(0)

  // Leave the shared profile clean.
  await page.evaluate(() => (window as unknown as { jarvis: { settings: { update: (p: object) => Promise<unknown> } } }).jarvis.settings.update({ disabledTools: [] }))
  await page.evaluate((mid: string) => (window as unknown as { jarvis: { memory: { delete: (id: string) => Promise<unknown> } } }).jarvis.memory.delete(mid), id)
  await closeApp(app)
})

test('settings: tool switches and the standing permission persist', async () => {
  const { app, page } = await launch(profile)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: 'Permissions' }).click()
  const del = page.getByRole('switch', { name: 'Delete a memory' })
  await expect(del).toHaveAttribute('aria-checked', 'true')
  await del.click()
  await expect(del).toHaveAttribute('aria-checked', 'false')
  const mandate = page.getByRole('switch', { name: 'Save memories without asking' })
  await expect(mandate).toHaveAttribute('aria-checked', 'false')
  await mandate.click()
  await expect(mandate).toHaveAttribute('aria-checked', 'true')
  // With the mandate on, saving no longer asks.
  const r = await invoke(page, 'save_memory', { text: 'Uses metric units', scope: 'workspace' })
  expect(r.output).toContain('Saved')
  // Restore defaults and remove the test memory.
  await del.click()
  await mandate.click()
  await expect(mandate).toHaveAttribute('aria-checked', 'false')
  await page.evaluate(async () => {
    const j = (window as unknown as { jarvis: ToolBridge & { memory: { delete: (id: string) => Promise<unknown> } } }).jarvis
    const r = await j.memory.list()
    for (const m of r.value ?? []) if (m.text === 'Uses metric units') await j.memory.delete(m.id)
  })
  await closeApp(app)
})

test('connections: GitHub token is validated locally; repositories need a connection first', async () => {
  const { app, page } = await launch(profile)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: 'Connections' }).click()
  const gh = page.locator('.provider').filter({ hasText: 'GitHub' })
  await expect(gh.locator('.status-line')).toContainText('Not connected')
  await gh.locator('input[type="password"]').fill('sk-proj-' + 'a'.repeat(40))
  await gh.getByRole('button', { name: 'Verify and save' }).click()
  await expect(gh.locator('.form-msg.is-error')).toContainText("doesn't look like a GitHub personal access token")
  // No token: nothing can be allowed, and the bridge refuses too.
  await expect(page.getByRole('button', { name: 'Check and allow' })).toBeDisabled()
  const check = await page.evaluate(() =>
    (window as unknown as { jarvis: { github: { checkRepo: (r: string) => Promise<{ ok: boolean; message?: string }> } } }).jarvis.github.checkRepo('octocat/hello-world'),
  )
  expect(check).toEqual({ ok: false, message: 'Connect GitHub first: add a token above.' })
  // GitHub tools aren't offered or runnable without a connection and an allowed repo.
  const r = await invoke(page, 'github_list_repos', {})
  expect(r.output).toMatch(/^Not run: No access to github:read/)
  await expect(page.locator('.approval')).toHaveCount(0)
  await closeApp(app)
})

type ReminderBridge = {
  reminders: { add: (text: string, dueAt: number) => Promise<{ ok: boolean; message?: string }> }
  settings: { update: (p: object) => Promise<unknown> }
}

test('reminders: add and cancel from the dashboard; a due reminder fires, snoozes and dismisses', async () => {
  test.setTimeout(LAUNCH_BUDGET + 90_000) // one launch, plus waiting for a real reminder to fire
  const { app, page } = await launch(profile)
  // Keep the test run quiet: no macOS notifications.
  await page.evaluate(() => (window as unknown as { jarvis: ReminderBridge }).jarvis.settings.update({ reminderNotifications: false }))

  const panel = page.getByRole('region', { name: 'Reminders' })
  await panel.getByRole('button', { name: 'Add reminder' }).click()
  await panel.getByLabel('Reminder', { exact: true }).fill('Water the plants')
  const later = await page.evaluate(() => {
    const d = new Date(Date.now() + 26 * 3600_000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  })
  await panel.getByLabel('When', { exact: true }).fill(later)
  await panel.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(panel.locator('.reminder-row', { hasText: 'Water the plants' })).toBeVisible()
  await panel.getByRole('button', { name: 'Cancel reminder: Water the plants' }).click()
  await expect(panel.locator('.reminder-row', { hasText: 'Water the plants' })).toHaveCount(0)

  // Due in 2 seconds: the scheduler (10 s tick) fires it into the panel and the conversation.
  const added = await page.evaluate(() =>
    (window as unknown as { jarvis: ReminderBridge }).jarvis.reminders.add('Stretch break', Date.now() + 2000),
  )
  expect(added.ok).toBe(true)
  const alert = panel.locator('.reminder-alert', { hasText: 'Stretch break' })
  await expect(alert).toBeVisible({ timeout: 25_000 })
  await expect(page.locator('.msg-reminder', { hasText: 'Stretch break' })).toBeVisible()
  await expect(page.locator('.terminal-line')).toContainText('Reminder: Stretch break')
  await alert.getByRole('button', { name: '10 min' }).click()
  await expect(panel.locator('.reminder-row', { hasText: 'Stretch break' })).toBeVisible()

  // Past times are refused.
  const past = await page.evaluate(() => (window as unknown as { jarvis: ReminderBridge }).jarvis.reminders.add('Too late', Date.now() - 3600_000))
  expect(past).toEqual({ ok: false, code: 'invalid_input', message: 'That time has already passed.' })

  // Clean up: cancel the snoozed one.
  await panel.getByRole('button', { name: 'Cancel reminder: Stretch break' }).click()
  await expect(panel.locator('.reminder-row')).toHaveCount(0)
  await closeApp(app)
})

test('reminders: Jarvis setting one asks first; approving puts it on the list', async () => {
  const { app, page } = await launch(profile)
  const when = await page.evaluate(() => {
    const d = new Date(Date.now() + 2 * 86_400_000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:30`
  })
  const setting = invoke(page, 'set_reminder', { text: 'Renew the domain', when })
  const card = page.locator('.approval').filter({ hasText: 'Renew the domain' })
  await expect(card.locator('.risk-badge')).toHaveText('Medium risk')
  await expect(card).toContainText('Remind you')
  await card.getByRole('button', { name: 'Approve' }).click()
  expect((await setting).output).toContain('alerts only while the JARVIS app is open')
  const panel = page.getByRole('region', { name: 'Reminders' })
  await expect(panel.locator('.reminder-row', { hasText: 'Renew the domain' })).toBeVisible()
  await panel.getByRole('button', { name: 'Cancel reminder: Renew the domain' }).click()
  await expect(panel.locator('.reminder-row', { hasText: 'Renew the domain' })).toHaveCount(0)
  await closeApp(app)
})

test('background mode: menu-bar icon on and off; open-at-login only in the installed app', async () => {
  const { app, page } = await launch(profile)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: 'Notifications' }).click()
  const bg = page.getByRole('switch', { name: 'Keep running in the menu bar' })
  const login = page.getByRole('switch', { name: 'Open at login' })
  await expect(bg).toHaveAttribute('aria-checked', 'false')
  await expect(login).toBeDisabled()
  await bg.click()
  await expect(page.getByText('Menu-bar icon is showing.')).toBeVisible()
  await expect(page.getByText('Available in the installed app')).toBeVisible()
  await expect(login).toBeDisabled() // development build
  await bg.click()
  await expect(page.getByText('Menu-bar mode is off.')).toBeVisible()
  await closeApp(app)
})

test('stop levels: stopping a running action withdraws its approval and logs it', async () => {
  const { app, page } = await launch(profile)
  const pending = invoke(page, 'save_memory', { text: 'Should be stopped', scope: 'workspace' })
  const running = page.getByRole('region', { name: 'Running' })
  await expect(running.locator('.running-task')).toContainText('Voice: Save a memory')
  await expect(running.locator('.running-task')).toContainText('Now: Save a memory')
  await expect(page.locator('.approval').filter({ hasText: 'Should be stopped' })).toBeVisible()
  await running.getByRole('button', { name: 'Stop action: Save a memory' }).click()
  expect((await pending).output).toContain('stopped this action')
  await expect(page.locator('.approval')).toHaveCount(0)
  await expect(running).toHaveCount(0) // section disappears when nothing runs
  await expect(page.locator('.run').first()).toContainText('Should be stopped')
  await expect(page.locator('.run-decision').first()).toContainText('Not done')
  const memories: Awaited<ReturnType<ToolBridge['memory']['list']>> = await page.evaluate(() =>
    (window as unknown as { jarvis: ToolBridge }).jarvis.memory.list(),
  )
  expect(memories.value?.some((m) => m.text === 'Should be stopped')).toBe(false)
  await closeApp(app)
})

test('helpers: refused without a text-model key; switchable in Permissions', async () => {
  const { app, page } = await launch(profile)
  const r = await invoke(page, 'delegate', { task: 'List the open issues in octocat/hello-world and summarise them.' })
  expect(r.output).toMatch(/^Not run: No access to agents:delegate/)
  await expect(page.locator('.approval')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: 'Permissions' }).click()
  await expect(page.getByRole('switch', { name: 'Hand off to a helper' })).toHaveAttribute('aria-checked', 'true')
  await closeApp(app)
})

test('routines: create from a template, schedule, run honestly without a key, pause, delete', async () => {
  test.setTimeout(LAUNCH_BUDGET + 60_000)
  const { app, page } = await launch(profile)
  await page.getByRole('button', { name: 'Routines', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Routines', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'New routine' }).click()
  const editor = page.getByRole('form', { name: 'Routine editor' })
  await editor.getByRole('button', { name: 'Morning briefing' }).click()
  await expect(editor.getByLabel('Routine name')).toHaveValue('Morning briefing')
  await editor.getByRole('button', { name: 'Create' }).click()

  const item = page.getByRole('listitem', { name: 'Morning briefing' })
  await expect(item).toContainText(/Weekdays at 7:30\sAM · next/)

  // No AI key in the test profile: the run is recorded as failed, with the honest reason.
  await item.getByRole('button', { name: 'Run now' }).click()
  const results = item.getByRole('list', { name: 'Results for Morning briefing' })
  await expect(results.locator('.wf-run').first()).toContainText('Failed')
  await expect(results.locator('.wf-run').first()).toContainText('No OpenAI key is saved')

  // Pause it: the schedule stays but shows as paused.
  await item.getByRole('button', { name: 'Edit' }).click()
  await editor.getByLabel(/^Active/).uncheck()
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(item).toContainText('paused')

  // The result was also posted to the conversation.
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await expect(page.locator('.msg-workflow')).toContainText('Morning briefing (failed)')

  await page.getByRole('button', { name: 'Routines', exact: true }).click()
  await item.getByRole('button', { name: 'Delete' }).click()
  await item.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No routines yet.')).toBeVisible()
  await closeApp(app)
})
