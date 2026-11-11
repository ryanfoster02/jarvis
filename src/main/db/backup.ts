// Backup file operations (Sprint 18). Node only, no Electron: tested with node:test on temp files.
import { randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { backupKind, backupsToPrune, dailyBackupName, isDailyDue, type BackupInfo, type BackupSummary } from '../../shared/backup.ts'
import { MIGRATIONS, schemaVersion } from './migrations.ts'

export class BackupError extends Error {}

/** Largest file JARVIS will open as a backup (a real one is a few MB). */
export const MAX_BACKUP_BYTES = 2 * 1024 ** 3

/**
 * Consistent copy of the live database, even while it's in use (SQLite's VACUUM INTO). Written to a
 * temporary name and renamed into place, so a half-written file never carries the real name.
 */
export function snapshotTo(sqlite: DatabaseSync, dest: string): number {
  const tmp = `${dest}.partial-${randomUUID()}`
  try {
    sqlite.prepare('VACUUM INTO ?').run(tmp)
    renameSync(tmp, dest)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  try {
    chmodSync(dest, 0o600) // conversations and memories are private
  } catch {
    /* not supported on every file system */
  }
  return statSync(dest).size
}

const REQUIRED_TABLES = ['workspaces', 'conversations', 'messages']
const COUNTED: Array<[keyof BackupSummary['counts'], string]> = [
  ['conversations', 'conversations'],
  ['messages', 'messages'],
  ['memories', 'memories'],
  ['leads', 'leads'],
  ['reminders', 'reminders'],
  ['routines', 'workflows'],
]

/** Opens a candidate backup read-only and checks it is an intact JARVIS database this version can use. */
export function inspectBackup(path: string): BackupSummary {
  let size: number
  let mtime: number
  try {
    const st = statSync(path)
    if (!st.isFile()) throw new BackupError('That is not a file.')
    size = st.size
    mtime = st.mtimeMs
  } catch (err) {
    if (err instanceof BackupError) throw err
    throw new BackupError('The backup file could not be read.')
  }
  if (size === 0) throw new BackupError('The backup file is empty.')
  if (size > MAX_BACKUP_BYTES) throw new BackupError('The file is too large to be a JARVIS backup.')
  let db: DatabaseSync
  try {
    db = new DatabaseSync(path, { readOnly: true })
  } catch {
    throw new BackupError('That file is not a database JARVIS can open.')
  }
  try {
    let integrity: unknown
    try {
      integrity = (db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined)?.integrity_check
    } catch {
      throw new BackupError('That file is not a JARVIS backup (not a SQLite database).')
    }
    if (integrity !== 'ok') throw new BackupError('The backup is damaged (integrity check failed).')
    const version = schemaVersion(db)
    if (version > MIGRATIONS.length) throw new BackupError('The backup comes from a newer version of JARVIS. Update JARVIS first.')
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name),
    )
    if (version < 1 || !REQUIRED_TABLES.every((t) => tables.has(t))) throw new BackupError('That database is not a JARVIS backup.')
    const counts = { conversations: 0, messages: 0, memories: 0, leads: 0, reminders: 0, routines: 0 }
    for (const [key, table] of COUNTED) {
      if (tables.has(table)) counts[key] = Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n)
    }
    return { fileName: path.split(/[\\/]/).pop() ?? 'backup', sizeBytes: size, modifiedAt: mtime, schemaVersion: version, counts }
  } finally {
    db.close()
  }
}

/** Automatic backups in `dir`, newest first. Files that aren't JARVIS backup names are ignored. */
export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  const out: BackupInfo[] = []
  for (const name of readdirSync(dir)) {
    const kind = backupKind(name)
    if (!kind) continue
    try {
      const st = statSync(join(dir, name))
      if (st.isFile()) out.push({ name, kind, sizeBytes: st.size, createdAt: st.mtimeMs })
    } catch {
      /* vanished meanwhile */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
}

export function pruneBackups(dir: string): string[] {
  const removed = backupsToPrune(listBackups(dir).map((b) => b.name))
  for (const name of removed) rmSync(join(dir, name), { force: true })
  return removed
}

/** Today's backup if there isn't one yet, then pruning. Returns the new file's name, or null if none was due. */
export function runDailyBackup(sqlite: DatabaseSync, dir: string, now: number): string | null {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const names = listBackups(dir).map((b) => b.name)
  let made: string | null = null
  if (isDailyDue(names, now)) {
    made = dailyBackupName(now)
    snapshotTo(sqlite, join(dir, made))
  }
  pruneBackups(dir)
  return made
}

/**
 * Puts `src` in place of the live database file. Call only with the live database closed. The old
 * write-ahead log is removed so it can't be replayed onto the restored file.
 */
export function replaceDatabaseFile(src: string, livePath: string): void {
  const staged = `${livePath}.restoring-${randomUUID()}`
  copyFileSync(src, staged)
  try {
    rmSync(`${livePath}-wal`, { force: true })
    rmSync(`${livePath}-shm`, { force: true })
    renameSync(staged, livePath)
  } catch (err) {
    rmSync(staged, { force: true })
    throw err
  }
}
