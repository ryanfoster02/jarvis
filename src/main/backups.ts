import { app, BrowserWindow, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  RESTORE_TOKEN_TTL_MS,
  safetyBackupName,
  type BackupCreateResult,
  type BackupInspectResult,
  type BackupListResult,
  type BackupRestoreResult,
  type BackupSource,
} from '../shared/backup.ts'
import { openDatabase } from './db/client.ts'
import { BackupError, inspectBackup, listBackups, pruneBackups, replaceDatabaseFile, runDailyBackup, snapshotTo } from './db/backup.ts'
import type { HistoryStore } from './ipc.ts'
import { setDatabasePath } from './perf.ts'
import { startScheduler, stopScheduler } from './scheduler.ts'
import { startWorkflowScheduler, stopWorkflowScheduler } from './workflows.ts'
import { setBackgroundDatabase } from './background.ts'
import { tasks } from './tasks.ts'

// Backups and restore (Sprint 18). Daily automatic copies in userData/backups (last 7 kept), a manual
// copy to a place the owner picks, and restore from either — always with a safety copy first.
// The renderer never names a path: main shows the dialogs, and restores only what it inspected.

let livePath = ''
let backupDir = ''
let store: HistoryStore | null = null
let timer: ReturnType<typeof setInterval> | null = null
const pending = new Map<string, { path: string; at: number }>()

const CHECK_EVERY_MS = 6 * 60 * 60_000

function daily(): void {
  const sqlite = store?.database?.sqlite
  if (!sqlite) return
  try {
    runDailyBackup(sqlite, backupDir, Date.now())
  } catch (err) {
    console.error('[backup] daily backup failed:', err)
  }
}

export function initBackups(history: HistoryStore, databasePath: string): void {
  store = history
  livePath = databasePath
  backupDir = join(app.getPath('userData'), 'backups')
  // After startup work has settled, then every few hours (a new day may have begun).
  setTimeout(daily, 20_000)
  timer ??= setInterval(daily, CHECK_EVERY_MS)
}

export function stopBackups(): void {
  if (timer) clearInterval(timer)
  timer = null
}

const unavailable = (): { ok: false; cancelled: false; message: string } => ({
  ok: false,
  cancelled: false,
  message: `Backups need the database, which isn't open${store?.error ? `: ${store.error}` : '.'}`,
})

const parentWindow = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

export function listAutoBackups(): BackupListResult {
  if (!backupDir) return { ok: false, message: 'Backups are not set up.' }
  try {
    return { ok: true, backups: listBackups(backupDir) }
  } catch (err) {
    return { ok: false, message: `Couldn't read the backups folder: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function createBackupFile(): Promise<BackupCreateResult> {
  const sqlite = store?.database?.sqlite
  if (!sqlite) return unavailable()
  const stamp = new Date().toISOString().slice(0, 10)
  const options = {
    title: 'Back up JARVIS',
    defaultPath: `jarvis-backup-${stamp}.db`,
    filters: [{ name: 'JARVIS backup', extensions: ['db'] }],
  }
  const win = parentWindow()
  const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (choice.canceled || !choice.filePath) return { ok: false, cancelled: true, message: 'Backup cancelled.' }
  if (choice.filePath === livePath) return { ok: false, cancelled: false, message: 'Choose a different file from the live database.' }
  try {
    const sizeBytes = snapshotTo(sqlite, choice.filePath)
    return { ok: true, fileName: choice.filePath.split(/[\\/]/).pop() ?? 'backup', sizeBytes }
  } catch (err) {
    return { ok: false, cancelled: false, message: `Backup failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function inspectSource(source: BackupSource): Promise<BackupInspectResult> {
  if (!store?.database && !store?.error) return unavailable()
  let path: string
  if (source.kind === 'auto') {
    if (!listBackups(backupDir).some((b) => b.name === source.name)) return { ok: false, cancelled: false, message: 'That backup no longer exists.' }
    path = join(backupDir, source.name)
  } else {
    const options = {
      title: 'Restore JARVIS from a backup',
      properties: ['openFile' as const],
      filters: [{ name: 'JARVIS backup', extensions: ['db'] }],
    }
    const win = parentWindow()
    const choice = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = choice.filePaths[0]
    if (choice.canceled || !picked) return { ok: false, cancelled: true, message: 'Restore cancelled.' }
    if (picked === livePath) return { ok: false, cancelled: false, message: 'That is the live database, not a backup.' }
    path = picked
  }
  try {
    const summary = inspectBackup(path)
    const token = randomUUID()
    pending.clear() // only the latest inspection can be restored
    pending.set(token, { path, at: Date.now() })
    return { ok: true, token, summary }
  } catch (err) {
    return { ok: false, cancelled: false, message: err instanceof BackupError ? err.message : 'The backup could not be checked.' }
  }
}

/**
 * Swaps in the inspected backup without restarting: safety copy of the current data, stop the jobs
 * that use the database, close it, replace the file, reopen (migrating an older backup forward),
 * and restart the jobs. If the backup won't open, the safety copy goes back.
 */
export async function restoreFromToken(token: string): Promise<BackupRestoreResult> {
  const entry = pending.get(token)
  pending.delete(token)
  if (!entry || Date.now() - entry.at > RESTORE_TOKEN_TTL_MS) return { ok: false, message: 'Pick the backup again: the check expired.' }
  if (!store) return { ok: false, message: 'Backups are not set up.' }
  if (tasks.list().length > 0) return { ok: false, message: 'Jarvis is working on something. Stop it or let it finish, then restore.' }
  try {
    inspectBackup(entry.path) // re-check: the file may have changed since
  } catch (err) {
    return { ok: false, message: err instanceof BackupError ? err.message : 'The backup could not be checked.' }
  }

  const safetyName = safetyBackupName(Date.now())
  const safetyPath = join(backupDir, safetyName)
  if (store.database) {
    try {
      mkdirSync(backupDir, { recursive: true, mode: 0o700 })
      snapshotTo(store.database.sqlite, safetyPath)
    } catch (err) {
      return { ok: false, message: `Couldn't save your current data first, so nothing was changed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  stopScheduler()
  stopWorkflowScheduler()
  setBackgroundDatabase(null)
  store.database?.close()
  store.database = null

  let message: string | null = null
  try {
    replaceDatabaseFile(entry.path, livePath)
    store.database = openDatabase(livePath)
    store.error = null
  } catch (err) {
    message = `The backup couldn't be opened (${err instanceof Error ? err.message : String(err)}); your previous data was put back.`
    try {
      replaceDatabaseFile(safetyPath, livePath)
      store.database = openDatabase(livePath)
      store.error = null
    } catch (again) {
      store.error = again instanceof Error ? again.message : String(again)
    }
  }

  const db = store.database
  setDatabasePath(db ? livePath : null)
  setBackgroundDatabase(db?.db ?? null)
  if (db) {
    void startScheduler(db.db)
    void startWorkflowScheduler(db.db)
  }
  pruneBackups(backupDir)
  // The renderer reloads itself after showing the result, so every screen reads the restored data.
  return message ? { ok: false, message } : { ok: true, safetyCopy: safetyName }
}

export async function showBackupFolder(): Promise<void> {
  if (!backupDir) return
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  await shell.openPath(backupDir)
}
