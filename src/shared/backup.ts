// Database backups (Sprint 18). Pure: file names, which backups to keep, when the next is due,
// and validation of what the renderer may ask for. File work lives in src/main/db/backup.ts.

import { IpcValidationError } from './ipc.ts'

/** Daily automatic backups kept in userData/backups. */
export const KEEP_DAILY = 7
/** Safety copies taken right before a restore. */
export const KEEP_SAFETY = 3
/** A restore must follow its inspection within this time. */
export const RESTORE_TOKEN_TTL_MS = 5 * 60_000

const DAILY = /^jarvis-(\d{4})-(\d{2})-(\d{2})\.db$/
const SAFETY = /^jarvis-before-restore-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/

export type BackupKind = 'daily' | 'safety'

const pad = (n: number): string => String(n).padStart(2, '0')
const localDay = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dailyBackupName(now: number): string {
  return `jarvis-${localDay(now)}.db`
}

export function safetyBackupName(now: number): string {
  const d = new Date(now)
  return `jarvis-before-restore-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`
}

export function backupKind(name: string): BackupKind | null {
  if (DAILY.test(name)) return 'daily'
  if (SAFETY.test(name)) return 'safety'
  return null
}

/** A daily backup is due when none exists for today (local date). */
export function isDailyDue(names: readonly string[], now: number): boolean {
  return !names.includes(dailyBackupName(now))
}

/** Names to delete: all but the newest KEEP_DAILY daily and KEEP_SAFETY safety backups. Other files are never touched. */
export function backupsToPrune(names: readonly string[]): string[] {
  const newestFirst = (k: BackupKind): string[] => names.filter((n) => backupKind(n) === k).sort().reverse()
  return [...newestFirst('daily').slice(KEEP_DAILY), ...newestFirst('safety').slice(KEEP_SAFETY)]
}

/** What the renderer may ask to inspect: a file the owner picks in a dialog (main shows it), or a listed backup by name. */
export type BackupSource = { kind: 'file' } | { kind: 'auto'; name: string }

export function validateBackupSource(input: unknown): BackupSource {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new IpcValidationError('backup source must be an object')
  const o = input as Record<string, unknown>
  if (o.kind === 'file' && Object.keys(o).length === 1) return { kind: 'file' }
  if (o.kind === 'auto' && Object.keys(o).length === 2 && typeof o.name === 'string' && backupKind(o.name)) {
    return { kind: 'auto', name: o.name }
  }
  throw new IpcValidationError('backup source must be a file to pick or a listed backup')
}

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function validateRestoreToken(input: unknown): string {
  if (typeof input !== 'string' || !TOKEN.test(input)) throw new IpcValidationError('restore token is not valid')
  return input
}

export interface BackupSummary {
  fileName: string
  sizeBytes: number
  /** File time (for listed backups, when it was made). */
  modifiedAt: number
  schemaVersion: number
  counts: { conversations: number; messages: number; memories: number; leads: number; reminders: number; routines: number }
}

export interface BackupInfo {
  name: string
  kind: BackupKind
  sizeBytes: number
  createdAt: number
}

export type BackupListResult = { ok: true; backups: BackupInfo[] } | { ok: false; message: string }
export type BackupCreateResult = { ok: true; fileName: string; sizeBytes: number } | { ok: false; cancelled: boolean; message: string }
export type BackupInspectResult = { ok: true; token: string; summary: BackupSummary } | { ok: false; cancelled: boolean; message: string }
export type BackupRestoreResult = { ok: true; safetyCopy: string } | { ok: false; message: string }

/** "12 conversations · 340 messages · 25 memories · 8 leads" — zero counts left out. */
export function describeCounts(c: BackupSummary['counts']): string {
  const parts: Array<[number, string]> = [
    [c.conversations, 'conversation'],
    [c.messages, 'message'],
    [c.memories, 'memory'],
    [c.leads, 'lead'],
    [c.reminders, 'reminder'],
    [c.routines, 'routine'],
  ]
  const words = parts
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${n === 1 ? w : w === 'memory' ? 'memories' : `${w}s`}`)
  return words.length ? words.join(' · ') : 'no saved data'
}
