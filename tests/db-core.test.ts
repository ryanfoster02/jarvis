// Database core: executor + migrations on Node's built-in node:sqlite (no Drizzle needed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { execute } from '../src/main/db/executor.ts'
import { configure, migrate, MIGRATIONS, schemaVersion, seedWorkspaces } from '../src/main/db/migrations.ts'
import { WORKSPACES } from '../src/shared/ipc.ts'

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  configure(db)
  migrate(db)
  seedWorkspaces(db)
  return db
}

test('migrations: apply once, record version, idempotent on reopen', () => {
  const db = new DatabaseSync(':memory:')
  assert.equal(schemaVersion(db), 0)
  assert.equal(migrate(db), MIGRATIONS.length)
  assert.equal(schemaVersion(db), MIGRATIONS.length)
  assert.equal(migrate(db), MIGRATIONS.length) // no-op
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => (r as { name: string }).name)
  assert.deepEqual(tables, ['conversations', 'memories', 'messages', 'reminders', 'tool_runs', 'workspaces'])
})

test('migrations: failed migration rolls back and leaves version unchanged', () => {
  const db = new DatabaseSync(':memory:')
  assert.throws(() => migrate(db, ['CREATE TABLE a (x); THIS IS NOT SQL;']))
  assert.equal(schemaVersion(db), 0)
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='a'").get()?.n, 0)
})

test('migrations: refuse a database from a newer app version', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5}`)
  assert.throws(() => migrate(db), /newer than this version/)
})

test('seed: built-in workspaces exist once', () => {
  const db = fresh()
  seedWorkspaces(db)
  const n = db.prepare('SELECT count(*) AS n FROM workspaces').get() as { n: number }
  assert.equal(n.n, WORKSPACES.length)
})

test('constraints: foreign keys, cascade delete, role/via checks', () => {
  const db = fresh()
  assert.throws(() => db.prepare("INSERT INTO conversations VALUES ('c1','nope','t',1,1)").run(), /FOREIGN KEY/)
  db.prepare("INSERT INTO conversations VALUES ('c1','personal','t',1,1)").run()
  db.prepare("INSERT INTO messages VALUES ('m1','c1','user','hi','text',1)").run()
  assert.throws(() => db.prepare("INSERT INTO messages VALUES ('m2','c1','system','x','text',1)").run(), /CHECK/)
  assert.throws(() => db.prepare("INSERT INTO messages VALUES ('m3','c1','user','x','fax',1)").run(), /CHECK/)
  db.prepare("DELETE FROM conversations WHERE id='c1'").run()
  assert.equal((db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n, 0)
})

test('executor: Drizzle proxy contract — arrays in column order, run/get/all/values', () => {
  const db = fresh()
  assert.deepEqual(execute(db, "INSERT INTO conversations VALUES (?, ?, ?, ?, ?)", ['c1', 'personal', 'Hello', 10, 20], 'run'), { rows: [] })
  assert.deepEqual(execute(db, 'SELECT id, title, updated_at FROM conversations', [], 'all'), { rows: [['c1', 'Hello', 20]] })
  assert.deepEqual(execute(db, 'SELECT title, id FROM conversations WHERE id = ?', ['c1'], 'get'), { rows: ['Hello', 'c1'] })
  assert.equal(execute(db, 'SELECT id FROM conversations WHERE id = ?', ['zzz'], 'get').rows, undefined)
  assert.deepEqual(execute(db, 'SELECT id FROM conversations', [], 'values'), { rows: [['c1']] })
})

test('executor: coerces booleans/undefined/dates; parameters prevent injection', () => {
  const db = fresh()
  execute(db, 'CREATE TABLE t (a, b, c)', [], 'run')
  execute(db, 'INSERT INTO t VALUES (?, ?, ?)', [true, undefined, new Date(5)], 'run')
  assert.deepEqual(execute(db, 'SELECT a, b, c FROM t', [], 'all').rows, [[1, null, 5]])
  const evil = "x'); DROP TABLE conversations; --"
  execute(db, "INSERT INTO conversations VALUES (?, 'personal', ?, 1, 1)", ['c9', evil], 'run')
  assert.deepEqual(execute(db, 'SELECT title FROM conversations WHERE id = ?', ['c9'], 'all').rows, [[evil]])
})

test('migration 2: memories table enforces scope/workspace pairing and allowed values', () => {
  const db = fresh()
  const ins = db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, 1, 1)')
  ins.run('m1', 'global', null, 'Owner is Ryan', 'user')
  ins.run('m2', 'workspace', 'research', 'Track LLM papers', 'conversation')
  assert.throws(() => ins.run('m3', 'global', 'research', 'x', 'user'), /CHECK/)
  assert.throws(() => ins.run('m4', 'workspace', null, 'x', 'user'), /CHECK/)
  assert.throws(() => ins.run('m5', 'team', null, 'x', 'user'), /CHECK/)
  assert.throws(() => ins.run('m6', 'workspace', 'nope', 'x', 'user'), /FOREIGN KEY/)
  assert.throws(() => ins.run('m7', 'global', null, 'x', 'jarvis'), /CHECK/)
})

test('migrations: an existing v1 database upgrades to v2 without losing data', () => {
  const db = new DatabaseSync(':memory:')
  configure(db)
  migrate(db, MIGRATIONS.slice(0, 1))
  seedWorkspaces(db)
  db.prepare("INSERT INTO conversations VALUES ('c1','personal','kept',1,1)").run()
  assert.equal(schemaVersion(db), 1)
  migrate(db)
  assert.equal(schemaVersion(db), MIGRATIONS.length)
  assert.equal((db.prepare("SELECT title FROM conversations WHERE id='c1'").get() as { title: string }).title, 'kept')
  assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='memories'").get() as { n: number }).n, 1)
})

test('action log table: constraints keep rows well-formed and workspace-bound', () => {
  const db = new DatabaseSync(':memory:')
  configure(db)
  migrate(db)
  seedWorkspaces(db)
  const ins = db.prepare(
    'INSERT INTO tool_runs (id, workspace_id, tool, risk, source, summary, decision, outcome, detail, created_at, duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
  ins.run('r1', 'personal', 'save_memory', 'medium', 'text', 'Remember: x', 'approved', 'ok', '', 1, 5)
  assert.throws(() => ins.run('r2', 'nowhere', 'get_time', 'low', 'text', 's', 'auto', 'ok', '', 1, 0), /FOREIGN KEY/)
  assert.throws(() => ins.run('r3', 'personal', 'get_time', 'extreme', 'text', 's', 'auto', 'ok', '', 1, 0), /CHECK/)
  assert.throws(() => ins.run('r4', 'personal', 'get_time', 'low', 'email', 's', 'auto', 'ok', '', 1, 0), /CHECK/)
  assert.throws(() => ins.run('r5', 'personal', 'get_time', 'low', 'text', 's', 'yolo', 'ok', '', 1, 0), /CHECK/)
  assert.throws(() => ins.run('r6', 'personal', 'get_time', 'low', 'text', 'x'.repeat(301), 'auto', 'ok', '', 1, 0), /CHECK/)
  assert.equal((db.prepare('SELECT count(*) AS n FROM tool_runs').get() as { n: number }).n, 1)
})

test('reminders table: lifecycle values and text length are enforced', () => {
  const db = new DatabaseSync(':memory:')
  configure(db)
  migrate(db)
  seedWorkspaces(db)
  const ins = db.prepare('INSERT INTO reminders (id, workspace_id, text, due_at, status, source, created_at) VALUES (?,?,?,?,?,?,?)')
  ins.run('a', 'personal', 'Call Acme', 10, 'pending', 'assistant', 1)
  assert.throws(() => ins.run('b', 'personal', '', 10, 'pending', 'user', 1), /CHECK/)
  assert.throws(() => ins.run('c', 'personal', 'x'.repeat(301), 10, 'pending', 'user', 1), /CHECK/)
  assert.throws(() => ins.run('d', 'personal', 'x', 10, 'snoozed', 'user', 1), /CHECK/)
  assert.throws(() => ins.run('e', 'personal', 'x', 10, 'pending', 'model', 1), /CHECK/)
  assert.throws(() => ins.run('f', 'nowhere', 'x', 10, 'pending', 'user', 1), /FOREIGN KEY/)
})
