import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { configure, migrate, MIGRATIONS, seedWorkspaces } from '../src/main/db/migrations.ts'
import { BackupError, inspectBackup, listBackups, replaceDatabaseFile, runDailyBackup, snapshotTo } from '../src/main/db/backup.ts'
import {
  backupKind,
  backupsToPrune,
  dailyBackupName,
  describeCounts,
  isDailyDue,
  KEEP_DAILY,
  KEEP_SAFETY,
  safetyBackupName,
  validateBackupSource,
  validateRestoreToken,
} from '../src/shared/backup.ts'
import { IpcValidationError } from '../src/shared/ipc.ts'

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-backup-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function liveDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  configure(db)
  migrate(db)
  seedWorkspaces(db)
  const now = Date.now()
  db.prepare("INSERT INTO conversations (id, workspace_id, title, created_at, updated_at) VALUES ('c1', 'personal', 'Hello', ?, ?)").run(now, now)
  db.prepare("INSERT INTO messages (id, conversation_id, role, text, via, created_at) VALUES ('m1', 'c1', 'user', 'Hi Jarvis', 'text', ?)").run(now)
  db.prepare("INSERT INTO messages (id, conversation_id, role, text, via, created_at) VALUES ('m2', 'c1', 'assistant', 'Good evening', 'text', ?)").run(now)
  return db
}

test('names: daily per local day, safety copies to the second; only our names are recognised', () => {
  const t = new Date(2026, 10, 11, 9, 5, 7).getTime()
  assert.equal(dailyBackupName(t), 'jarvis-2026-11-11.db')
  assert.equal(safetyBackupName(t), 'jarvis-before-restore-20261111-090507.db')
  assert.equal(backupKind('jarvis-2026-11-11.db'), 'daily')
  assert.equal(backupKind('jarvis-before-restore-20261111-090507.db'), 'safety')
  for (const bad of ['jarvis.db', '../jarvis-2026-11-11.db', 'jarvis-2026-11-11.db.partial-x', 'notes.txt']) assert.equal(backupKind(bad), null, bad)
  assert.equal(isDailyDue(['jarvis-2026-11-10.db'], t), true)
  assert.equal(isDailyDue(['jarvis-2026-11-11.db'], t), false)
})

test('pruning keeps the newest dailies and safety copies, never other files', () => {
  const daily = Array.from({ length: 10 }, (_, i) => `jarvis-2026-11-${String(i + 1).padStart(2, '0')}.db`)
  const safety = Array.from({ length: 5 }, (_, i) => `jarvis-before-restore-2026110${i + 1}-120000.db`)
  const pruned = backupsToPrune([...daily, ...safety, 'jarvis.db', 'readme.txt'])
  assert.deepEqual(pruned.sort(), [...daily.slice(0, 10 - KEEP_DAILY), ...safety.slice(0, 5 - KEEP_SAFETY)].sort())
})

test('renderer input: only "pick a file" or a listed backup name; tokens are UUIDs', () => {
  assert.deepEqual(validateBackupSource({ kind: 'file' }), { kind: 'file' })
  assert.deepEqual(validateBackupSource({ kind: 'auto', name: 'jarvis-2026-11-11.db' }), { kind: 'auto', name: 'jarvis-2026-11-11.db' })
  for (const bad of [null, [], { kind: 'auto', name: '../../etc/passwd' }, { kind: 'file', path: '/tmp/x.db' }, { kind: 'path', name: 'a' }]) {
    assert.throws(() => validateBackupSource(bad), IpcValidationError)
  }
  assert.equal(validateRestoreToken('0b8f7a2e-1d2c-4e5f-8a9b-0c1d2e3f4a5b'), '0b8f7a2e-1d2c-4e5f-8a9b-0c1d2e3f4a5b')
  assert.throws(() => validateRestoreToken('/tmp/x.db'), IpcValidationError)
  assert.equal(describeCounts({ conversations: 1, messages: 2, memories: 1, leads: 0, reminders: 0, routines: 0 }), '1 conversation · 2 messages · 1 memory')
  assert.equal(describeCounts({ conversations: 0, messages: 0, memories: 0, leads: 0, reminders: 0, routines: 0 }), 'no saved data')
})

test('snapshot of a live WAL database is complete and inspectable; overwrite works via rename', () => {
  withDir((dir) => {
    const db = liveDb(join(dir, 'jarvis.db'))
    const dest = join(dir, 'copy.db')
    assert.ok(snapshotTo(db, dest) > 0)
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, via, created_at) VALUES ('m3', 'c1', 'user', 'More', 'text', 1)").run()
    snapshotTo(db, dest) // replaces the earlier copy
    const s = inspectBackup(dest)
    assert.equal(s.schemaVersion, MIGRATIONS.length)
    assert.deepEqual(s.counts, { conversations: 1, messages: 3, memories: 0, leads: 0, reminders: 0, routines: 0 })
    assert.equal(s.fileName, 'copy.db')
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.partial-')), [])
    db.close()
  })
})

test('inspection refuses junk, non-JARVIS databases and backups from a newer version', () => {
  withDir((dir) => {
    const junk = join(dir, 'junk.db')
    writeFileSync(junk, 'this is not sqlite at all'.repeat(100))
    assert.throws(() => inspectBackup(junk), BackupError)
    const empty = join(dir, 'empty.db')
    writeFileSync(empty, '')
    assert.throws(() => inspectBackup(empty), /empty/)
    assert.throws(() => inspectBackup(join(dir, 'missing.db')), /could not be read/)

    const other = new DatabaseSync(join(dir, 'other.db'))
    other.exec('CREATE TABLE notes (x)')
    other.close()
    assert.throws(() => inspectBackup(join(dir, 'other.db')), /not a JARVIS backup/)

    const newer = liveDb(join(dir, 'newer.db'))
    newer.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    newer.close()
    assert.throws(() => inspectBackup(join(dir, 'newer.db')), /newer version/)
  })
})

test('daily backup: once per day, pruned, listed newest first', () => {
  withDir((dir) => {
    const db = liveDb(join(dir, 'jarvis.db'))
    const backups = join(dir, 'backups')
    const day = (d: number): number => new Date(2026, 10, d, 12).getTime()
    for (let d = 1; d <= 9; d++) assert.equal(runDailyBackup(db, backups, day(d)), dailyBackupName(day(d)))
    assert.equal(runDailyBackup(db, backups, day(9)), null) // already done today
    const list = listBackups(backups)
    assert.equal(list.length, KEEP_DAILY)
    assert.ok(list.every((b) => b.kind === 'daily'))
    assert.ok(!existsSync(join(backups, dailyBackupName(day(1)))))
    db.close()
  })
})

test('restore: the backup replaces the live file and opens with its data; stale WAL is not replayed', () => {
  withDir((dir) => {
    const live = join(dir, 'jarvis.db')
    const db = liveDb(live)
    const backup = join(dir, 'backup.db')
    snapshotTo(db, backup)
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, via, created_at) VALUES ('m9', 'c1', 'user', 'after backup', 'text', 1)").run()
    db.close()
    writeFileSync(`${live}-wal`, 'stale') // as if a crash left one behind
    replaceDatabaseFile(backup, live)
    assert.ok(!existsSync(`${live}-wal`))
    const reopened = new DatabaseSync(live)
    configure(reopened)
    migrate(reopened)
    const n = (reopened.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n
    assert.equal(n, 2)
    reopened.close()
    assert.ok(existsSync(backup), 'the source backup is kept')
  })
})
