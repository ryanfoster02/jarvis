import { describeGitHubError, GITHUB_API, GITHUB_API_VERSION, githubPaths, parseRepo } from '../shared/github.ts'
import type { GitHubRepoInfo } from '../shared/ipc.ts'

// GitHub calls. Main process only: the only place the GitHub token is used. GET requests only —
// this client has no way to write, comment, merge or push (Sprint 9 is read-only by design).

const TIMEOUT_MS = 20_000

export type GitHubResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string }

export async function githubGet(token: string, path: string, cancel?: AbortSignal): Promise<GitHubResult<unknown>> {
  if (!path.startsWith('/')) return { ok: false, status: 0, message: 'Invalid GitHub path.' }
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'JARVIS-desktop',
      },
      redirect: 'follow',
      signal: cancel ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), cancel]) : AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, status: res.status, message: describeGitHubError(res.status, text, res.headers.get('x-ratelimit-remaining')) }
    }
    try {
      return { ok: true, value: JSON.parse(text) as unknown }
    } catch {
      return { ok: false, status: res.status, message: 'GitHub sent a reply Jarvis could not read.' }
    }
  } catch (err) {
    if (cancel?.aborted) return { ok: false, status: 0, message: 'Cancelled.' }
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return {
      ok: false,
      status: 0,
      message: timedOut ? "GitHub didn't respond in time. Try again." : "Couldn't reach GitHub. Check your internet connection.",
    }
  }
}

/** Confirms the token works (GET /user needs no extra permission). Returns the account name. */
export async function verifyGitHubToken(token: string): Promise<GitHubResult<string>> {
  const r = await githubGet(token, githubPaths.user())
  if (!r.ok) return r
  const login = r.value && typeof r.value === 'object' ? (r.value as { login?: unknown }).login : undefined
  return { ok: true, value: typeof login === 'string' ? login : '' }
}

/** Checks the token can read a repository (used before adding it to the allowlist). */
export async function getRepo(token: string, repo: string): Promise<GitHubResult<GitHubRepoInfo>> {
  const r = await githubGet(token, githubPaths.repo(repo))
  if (!r.ok) return r
  return { ok: true, value: parseRepo(r.value) }
}
