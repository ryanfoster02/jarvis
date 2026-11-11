// Local leads pipeline (Sprint 15). Pure; unit-tested.

import { IpcValidationError, LEAD_STATUSES, type Lead, type LeadInput, type LeadStatus } from './ipc.ts'
import { detectSecret } from './memory.ts'

export const MAX_LEADS = 500
export const OPEN_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal']

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
}

const isStatus = (v: unknown): v is LeadStatus => typeof v === 'string' && (LEAD_STATUSES as readonly string[]).includes(v)

function text(v: unknown, field: string, max: number, required = false): string {
  if (v === undefined || v === null) v = ''
  if (typeof v !== 'string') throw new IpcValidationError(`${field} must be text.`)
  const t = v.replace(/[ \t]+/g, ' ').trim()
  if (required && !t) throw new IpcValidationError(`${field} is required.`)
  if (t.length > max) throw new IpcValidationError(`${field} must be under ${max} characters.`)
  return t
}

export function validateDate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new IpcValidationError('Dates must look like 2026-11-20.')
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) throw new IpcValidationError("That date doesn't exist.")
  return v
}

function value(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0
  const n = typeof v === 'string' ? Number(v.replace(/[,\s$€£]/g, '')) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e10) throw new IpcValidationError('Value must be a number from 0 up.')
  return Math.round(n)
}

/** Full validation (owner form or add_lead). Leads hold business contact data: no credentials. */
export function validateLeadInput(input: unknown): LeadInput {
  if (!input || typeof input !== 'object') throw new IpcValidationError('lead must be an object')
  const o = input as Record<string, unknown>
  const allowed = ['id', 'name', 'company', 'email', 'status', 'value', 'notes', 'nextStep', 'nextDate']
  const extra = Object.keys(o).filter((k) => !allowed.includes(k))
  if (extra.length) throw new IpcValidationError(`Unexpected field: ${extra[0]}`)
  if (o.id !== undefined && (typeof o.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(o.id))) throw new IpcValidationError('invalid lead id')
  const email = text(o.email, 'Email', 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IpcValidationError("That email address doesn't look right.")
  const status = o.status ?? 'new'
  if (!isStatus(status)) throw new IpcValidationError(`Status must be one of: ${LEAD_STATUSES.join(', ')}.`)
  const lead: LeadInput = {
    ...(typeof o.id === 'string' ? { id: o.id.toLowerCase() } : {}),
    name: text(o.name, 'Name', 80, true),
    company: text(o.company, 'Company', 80),
    email,
    status,
    value: value(o.value),
    notes: text(o.notes, 'Notes', 1000),
    nextStep: text(o.nextStep, 'Next step', 200),
    nextDate: validateDate(o.nextDate),
  }
  const secret = detectSecret(`${lead.notes} ${lead.nextStep} ${lead.company}`)
  if (secret) throw new IpcValidationError(`That looks like it contains ${secret}. Leads can't hold credentials.`)
  return lead
}

/** Apply a partial update (update_lead) onto an existing lead, re-validating the result. */
export function applyLeadPatch(lead: Lead, patch: Partial<Pick<LeadInput, 'status' | 'value' | 'notes' | 'nextStep' | 'nextDate'>>): LeadInput {
  const merged = { ...lead, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null)) }
  return validateLeadInput({
    id: merged.id,
    name: merged.name,
    company: merged.company,
    email: merged.email,
    status: merged.status,
    value: merged.value,
    notes: merged.notes,
    nextStep: merged.nextStep,
    nextDate: merged.nextDate,
  })
}

/** Local "today" as YYYY-MM-DD. */
export function todayIso(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface PipelineSummary {
  byStatus: Record<LeadStatus, { count: number; value: number }>
  openCount: number
  openValue: number
  /** Open leads whose next-step date has passed. */
  overdue: Lead[]
}

export function pipelineSummary(leads: readonly Lead[], now: number): PipelineSummary {
  const today = todayIso(now)
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, { count: 0, value: 0 }])) as PipelineSummary['byStatus']
  for (const l of leads) {
    byStatus[l.status].count++
    byStatus[l.status].value += l.value
  }
  const open = leads.filter((l) => OPEN_STATUSES.includes(l.status))
  return {
    byStatus,
    openCount: open.length,
    openValue: open.reduce((n, l) => n + l.value, 0),
    overdue: open.filter((l) => l.nextDate !== null && l.nextDate < today).sort((a, b) => (a.nextDate ?? '').localeCompare(b.nextDate ?? '')),
  }
}
