import { app, Notification, shell } from 'electron'
import { GITHUB_API, GITHUB_API_VERSION } from '../shared/github.ts'
import { compareVersions, parseLatestRelease, UPDATE_CHECK_EVERY_MS, UPDATE_REPO, type UpdateCheckResult } from '../shared/updates.ts'
import { loadSettings } from './settings.ts'
import { showMainWindow } from './windows.ts'

// Update check (Sprint 18): one unauthenticated GET of the project's latest published release on
// GitHub. No token, nothing about the owner is sent. JARVIS never downloads or installs anything:
// it shows the version and opens the release page in the browser when the owner asks.

const TIMEOUT_MS = 10_000
let last: UpdateCheckResult | null = null
let timer: ReturnType<typeof setInterval> | null = null
let notifiedVersion: string | null = null

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  try {
    const res = await fetch(`${GITHUB_API}/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': GITHUB_API_VERSION, 'User-Agent': 'JARVIS-desktop' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 404) {
      last = { ok: true, current, latest: null, newer: false, checkedAt: Date.now() }
      return last
    }
    if (!res.ok) {
      last = { ok: false, current, message: res.status === 403 || res.status === 429 ? 'GitHub is limiting requests right now. Try again later.' : `GitHub answered ${res.status}.` }
      return last
    }
    const latest = parseLatestRelease(await res.json())
    if (!latest) {
      last = { ok: false, current, message: "The latest release on GitHub couldn't be read." }
      return last
    }
    last = { ok: true, current, latest, newer: compareVersions(latest.version, current) > 0, checkedAt: Date.now() }
    return last
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    last = { ok: false, current, message: timedOut ? 'GitHub did not answer in time.' : "Couldn't reach GitHub. Check the internet connection." }
    return last
  }
}

/** Opens the page of the release found by the last check (never a URL from the renderer). */
export async function openLatestRelease(): Promise<boolean> {
  if (!last?.ok || !last.latest) return false
  await shell.openExternal(last.latest.url)
  return true
}

async function automatic(): Promise<void> {
  if (!loadSettings().checkForUpdates) return
  const r = await checkForUpdates()
  if (!r.ok || !r.newer || !r.latest || notifiedVersion === r.latest.version || !Notification.isSupported()) return
  notifiedVersion = r.latest.version
  const n = new Notification({ title: `JARVIS ${r.latest.version} is available`, body: 'Open Settings → About to download it.' })
  n.on('click', () => showMainWindow())
  n.show()
}

/** Daily check, only while the owner has it switched on (off by default). */
export function startUpdateChecks(): void {
  setTimeout(() => void automatic(), 60_000)
  timer ??= setInterval(() => void automatic(), UPDATE_CHECK_EVERY_MS)
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer)
  timer = null
}
