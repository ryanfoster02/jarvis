import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildReport,
  describeN8nError,
  executionLink,
  n8nHost,
  n8nPaths,
  parseExecutions,
  parseWorkflows,
  type AutomationReport,
  type N8nConnectionInput,
  type N8nStatus,
} from '../shared/n8n.ts'
import { encryptionAvailable } from './vault.ts'

// n8n oversight (Sprint 21). The instance address and API key are encrypted with safeStorage in
// userData/n8n.json. An n8n API key (non-Enterprise) has full access to the instance, so this client
// is read-only by construction: n8nGet is its only network call and it can only send GET.

export class N8nError extends Error {}

interface Stored {
  version: 1
  cipher: string
  host: string
  https: boolean
}

const file = (): string => join(app.getPath('userData'), 'n8n.json')

function load(): Stored | null {
  if (!existsSync(file())) return null
  try {
    const v = JSON.parse(readFileSync(file(), 'utf8')) as Stored
    return v.version === 1 && typeof v.cipher === 'string' ? v : null
  } catch {
    return null
  }
}

function connection(): N8nConnectionInput | null {
  const s = load()
  if (!s || !encryptionAvailable()) return null
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(s.cipher, 'base64'))) as N8nConnectionInput
  } catch {
    return null
  }
}

export function n8nStatus(): N8nStatus {
  const s = load()
  return { configured: !!s && connection() !== null, host: s?.host ?? null, https: !!s?.https, encryptionAvailable: encryptionAvailable() }
}

export const n8nConfigured = (): boolean => n8nStatus().configured

function store(c: N8nConnectionInput): void {
  if (!encryptionAvailable()) throw new N8nError('This computer can’t store secrets securely, so n8n can’t be connected.')
  mkdirSync(app.getPath('userData'), { recursive: true })
  const s: Stored = { version: 1, cipher: safeStorage.encryptString(JSON.stringify(c)).toString('base64'), host: n8nHost(c.url), https: c.url.startsWith('https://') }
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(s), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file())
}

export function removeN8n(): N8nStatus {
  rmSync(file(), { force: true })
  return n8nStatus()
}

/** The only request this client can make: GET, API key in the header, no redirects, 15 s limit. */
async function n8nGet(c: N8nConnectionInput, path: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${c.url}${path}`, {
      method: 'GET',
      headers: { 'X-N8N-API-KEY': c.apiKey, Accept: 'application/json' },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new N8nError(`Couldn't reach n8n at ${n8nHost(c.url)}. Is it running and reachable from this computer?`)
  }
  if (!res.ok) throw new N8nError(describeN8nError(res.status))
  try {
    return await res.json()
  } catch {
    throw new N8nError("n8n's answer wasn't readable (is that address really n8n?).")
  }
}

/** Saves only after the key works: one workflows request. */
export async function connectN8n(c: N8nConnectionInput): Promise<{ workflows: number; active: number }> {
  const wfs = parseWorkflows(await n8nGet(c, n8nPaths.workflows()))
  store(c)
  return { workflows: wfs.length, active: wfs.filter((w) => w.active).length }
}

export async function automationReport(hours: number, signal?: AbortSignal): Promise<{ report: AutomationReport; links: Record<string, string> }> {
  const c = connection()
  if (!c) throw new N8nError('n8n is not connected. Settings → Connections → n8n.')
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const [wfJson, exJson] = await Promise.all([n8nGet(c, n8nPaths.workflows(), signal), n8nGet(c, n8nPaths.failed(since), signal)])
  const failed = parseExecutions(exJson)
  const truncated = !!(exJson && typeof exJson === 'object' && (exJson as { nextCursor?: unknown }).nextCursor)
  const report = buildReport(n8nHost(c.url), hours, parseWorkflows(wfJson), failed, truncated)
  const links: Record<string, string> = {}
  for (const f of report.failing) {
    const l = executionLink(c.url, f.workflowId, f.lastExecutionId)
    if (l) links[f.workflowId] = l
  }
  return { report, links }
}
