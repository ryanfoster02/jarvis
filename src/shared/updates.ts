// Update check (Sprint 18). Pure: version comparison and release parsing. JARVIS only *tells* the
// owner a newer version exists and opens its download page — it never downloads or installs code
// itself (unsigned builds can't auto-update safely on macOS, and silent installs aren't wanted).

/** Releases come from the project's own GitHub repository, nowhere else. */
export const UPDATE_REPO = 'ryanfoster02/jarvis'
export const RELEASES_PAGE = `https://github.com/${UPDATE_REPO}/releases`
export const UPDATE_CHECK_EVERY_MS = 24 * 60 * 60_000

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function parseVersion(v: string): { major: number; minor: number; patch: number; pre: string | null } | null {
  const m = SEMVER.exec(v.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null }
}

/** >0 if a is newer than b, <0 if older, 0 if equal or either can't be read. A pre-release is older than its release. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] - y[k]
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre < y.pre ? -1 : 1
}

export interface ReleaseInfo {
  version: string
  name: string
  /** The release's page on github.com (download links are there). */
  url: string
  publishedAt: string | null
  notes: string
}

/** GitHub's "latest release" JSON → what JARVIS shows; anything off (wrong repo, odd URL, no version) is rejected. */
export function parseLatestRelease(json: unknown): ReleaseInfo | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (r.draft === true || r.prerelease === true) return null
  if (typeof r.tag_name !== 'string' || !parseVersion(r.tag_name)) return null
  if (typeof r.html_url !== 'string' || !r.html_url.startsWith(`${RELEASES_PAGE}/`)) return null
  return {
    version: r.tag_name.replace(/^v/, ''),
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : r.tag_name,
    url: r.html_url,
    publishedAt: typeof r.published_at === 'string' ? r.published_at : null,
    notes: typeof r.body === 'string' ? r.body.slice(0, 1500) : '',
  }
}

export type UpdateCheckResult =
  | { ok: true; current: string; latest: ReleaseInfo | null; newer: boolean; checkedAt: number }
  | { ok: false; current: string; message: string }
