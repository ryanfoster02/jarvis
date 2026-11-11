// n8n oversight (Sprint 21). Pure: connection validation, API paths, parsing, summaries.
//
// Checked 2026-11-11 (docs.n8n.io): self-hosted base https://<instance>/api/v1, header X-N8N-API-KEY.
// GET /workflows (limit ≤ 250, cursor, active, name …; items id, name, isArchived, activeVersionId,
// updatedAt; `active` deprecated). GET /executions (limit ≤ 250, cursor, status one of canceled |
// crashed | error | new | running | success | unknown | waiting, workflowId, startedAfter,
// includeData default false; items id, status, mode, startedAt, stoppedAt, workflowId, retryOf,
// retrySuccessId). Non-Enterprise API keys have FULL access (scopes are Enterprise-only), so JARVIS
// enforces read-only itself: its n8n client can only send GET requests.

import { IpcValidationError } from './ipc.ts'

export interface N8nConnectionInput {
  url: string
  apiKey: string
}

const isPrivateHost = (h: string): boolean =>
  h === 'localhost' ||
  h === '127.0.0.1' ||
  h === '[::1]' ||
  h.endsWith('.local') ||
  /^10\.\d+\.\d+\.\d+$/.test(h) ||
  /^192\.168\.\d+\.\d+$/.test(h) ||
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)

/**
 * The instance's base URL (what the owner types in the browser), normalised: no trailing slash,
 * no /api/v1, no credentials, query or fragment. https anywhere; http only on this computer or the
 * home/office network (the API key would otherwise cross the internet unencrypted).
 */
export function normalizeN8nUrl(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new IpcValidationError('Enter your n8n address, e.g. https://n8n.example.com')
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    throw new IpcValidationError('That is not a valid address. Include https://')
  }
  if (u.username || u.password) throw new IpcValidationError('Leave the user name and password out of the address.')
  if (u.protocol === 'http:' && !isPrivateHost(u.hostname)) {
    throw new IpcValidationError('Use https:// for an n8n on the internet (http is only allowed on this computer or your local network).')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new IpcValidationError('The address must start with https://')
  const path = u.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '').replace(/\/(home|workflows?)(\/.*)?$/, '')
  return `${u.protocol}//${u.host}${path}`
}

export function validateN8nConnection(input: unknown): N8nConnectionInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new IpcValidationError('connection must be an object')
  const o = input as Record<string, unknown>
  const extra = Object.keys(o).filter((k) => k !== 'url' && k !== 'apiKey')
  if (extra.length) throw new IpcValidationError(`unexpected field: ${extra[0]}`)
  const url = normalizeN8nUrl(o.url)
  const key = typeof o.apiKey === 'string' ? o.apiKey.trim() : ''
  if (!key) throw new IpcValidationError('Paste the API key from n8n → Settings → n8n API.')
  if (key.length < 20 || key.length > 4000 || /\s/.test(key)) throw new IpcValidationError("That doesn't look like an n8n API key.")
  return { url, apiKey: key }
}

export function n8nHost(base: string): string {
  try {
    return new URL(base).host
  } catch {
    return base
  }
}

export const n8nPaths = {
  workflows: (): string => '/api/v1/workflows?limit=250&excludePinnedData=true',
  failed: (sinceIso: string): string => `/api/v1/executions?${new URLSearchParams({ status: 'error', startedAfter: sinceIso, limit: '100' }).toString()}`,
} as const

export interface N8nWorkflow {
  id: string
  name: string
  active: boolean
  updatedAt: string | null
}

export interface N8nExecution {
  id: string
  workflowId: string
  status: string
  mode: string
  startedAt: string | null
  stoppedAt: string | null
  /** A later retry of this run succeeded. */
  retried: boolean
}

const items = (json: unknown): Array<Record<string, unknown>> => {
  const d = json && typeof json === 'object' ? (json as { data?: unknown }).data : null
  return Array.isArray(d) ? (d.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : []
}
const idOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null)

export function parseWorkflows(json: unknown): N8nWorkflow[] {
  const out: N8nWorkflow[] = []
  for (const w of items(json)) {
    const id = idOf(w.id)
    if (!id || w.isArchived === true) continue
    out.push({
      id,
      name: typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 120) : `Workflow ${id}`,
      active: (typeof w.activeVersionId === 'string' && w.activeVersionId !== '') || w.active === true,
      updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : null,
    })
  }
  return out
}

export function parseExecutions(json: unknown): N8nExecution[] {
  const out: N8nExecution[] = []
  for (const e of items(json)) {
    const id = idOf(e.id)
    const wf = idOf(e.workflowId)
    if (!id || !wf) continue
    out.push({
      id,
      workflowId: wf,
      status: typeof e.status === 'string' ? e.status : 'unknown',
      mode: typeof e.mode === 'string' ? e.mode : '',
      startedAt: typeof e.startedAt === 'string' ? e.startedAt : null,
      stoppedAt: typeof e.stoppedAt === 'string' ? e.stoppedAt : null,
      retried: idOf(e.retrySuccessId) !== null,
    })
  }
  return out
}

export interface AutomationReport {
  host: string
  hours: number
  workflows: { total: number; active: number }
  /** Workflows with failed runs in the window (retried-and-recovered runs excluded), worst first. */
  failing: Array<{ workflowId: string; name: string; failures: number; lastFailedAt: string | null; lastExecutionId: string }>
  truncated: boolean
}

export function buildReport(host: string, hours: number, workflows: readonly N8nWorkflow[], failed: readonly N8nExecution[], truncated: boolean): AutomationReport {
  const names = new Map(workflows.map((w) => [w.id, w.name]))
  const by = new Map<string, AutomationReport['failing'][number]>()
  for (const e of failed) {
    if (e.retried) continue
    const prev = by.get(e.workflowId)
    const later = !prev || (e.startedAt ?? '') > (prev.lastFailedAt ?? '')
    by.set(e.workflowId, {
      workflowId: e.workflowId,
      name: names.get(e.workflowId) ?? `Workflow ${e.workflowId}`,
      failures: (prev?.failures ?? 0) + 1,
      lastFailedAt: later ? e.startedAt : (prev?.lastFailedAt ?? null),
      lastExecutionId: later ? e.id : (prev?.lastExecutionId ?? e.id),
    })
  }
  return {
    host,
    hours,
    workflows: { total: workflows.length, active: workflows.filter((w) => w.active).length },
    failing: [...by.values()].sort((a, b) => b.failures - a.failures || (b.lastFailedAt ?? '').localeCompare(a.lastFailedAt ?? '')),
    truncated,
  }
}

/** Link to a run in the n8n editor (only offered for https instances; the app opens https links only). */
export function executionLink(base: string, workflowId: string, executionId: string): string | null {
  return base.startsWith('https://') ? `${base}/workflow/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}` : null
}

const when = (iso: string | null): string => {
  if (!iso) return 'time unknown'
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'time unknown'
}

export function formatReportForModel(r: AutomationReport): string {
  const lines = [
    `n8n at ${r.host}: ${r.workflows.total} workflows (${r.workflows.active} active). Failed runs in the last ${r.hours} hours (runs that a retry fixed are left out):`,
  ]
  if (r.failing.length === 0) lines.push('- None.')
  for (const f of r.failing.slice(0, 20)) {
    lines.push(`- ${f.name}: ${f.failures} failed run${f.failures === 1 ? '' : 's'}, last ${when(f.lastFailedAt)} (execution ${f.lastExecutionId})`)
  }
  if (r.failing.length > 20) lines.push(`… and ${r.failing.length - 20} more workflows with failures.`)
  if (r.truncated) lines.push('(Only the latest 100 failed runs were checked.)')
  lines.push('JARVIS can only read n8n: it cannot run, fix, activate or change workflows. Workflow names are the owner\'s own.')
  return lines.join('\n')
}

export type N8nStatus = { configured: boolean; host: string | null; https: boolean; encryptionAvailable: boolean }
export type N8nTestResult = { ok: true; workflows: number; active: number; status: N8nStatus } | { ok: false; message: string; status: N8nStatus }
export type AutomationReportResult = { ok: true; report: AutomationReport; links: Record<string, string> } | { ok: false; message: string }

export function describeN8nError(status: number): string {
  if (status === 401 || status === 403) return 'n8n rejected the API key. Create a new one in n8n → Settings → n8n API.'
  if (status === 404) return "n8n's API wasn't found at that address. Check the address, and that the public API isn't disabled on your instance."
  if (status === 429) return 'n8n is limiting requests. Try again shortly.'
  if (status >= 500) return `n8n had a server error (${status}).`
  return `n8n answered ${status}.`
}
