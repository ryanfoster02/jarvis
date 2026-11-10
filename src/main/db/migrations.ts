import type { DatabaseSync } from 'node:sqlite'
import { WORKSPACES } from '../../shared/ipc.ts'

// Schema migrations, applied in order and tracked with PRAGMA user_version.
// Never edit a shipped migration: append a new one. Keep in sync with schema.ts (Drizzle table definitions).
export const MIGRATIONS: readonly string[] = [
  // 1 — workspaces, conversations, messages
  `
  CREATE TABLE workspaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE conversations (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
    title         TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX conversations_ws_updated ON conversations(workspace_id, updated_at);
  CREATE TABLE messages (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text             TEXT NOT NULL,
    via              TEXT NOT NULL CHECK (via IN ('text', 'voice')),
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX messages_conversation_created ON messages(conversation_id, created_at);
  `,
  // 2 — memories (Sprint 6): global facts, or facts scoped to one workspace
  `
  CREATE TABLE memories (
    id            TEXT PRIMARY KEY,
    scope         TEXT NOT NULL CHECK (scope IN ('global', 'workspace')),
    workspace_id  TEXT REFERENCES workspaces(id),
    text          TEXT NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('user', 'conversation')),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    CHECK ((scope = 'global' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL))
  );
  CREATE INDEX memories_scope_ws_updated ON memories(scope, workspace_id, updated_at);
  `,
  // 3 — action log (Sprint 8): every tool call, how it was decided, and what happened.
  // Summaries are human-readable, capped, and never contain secrets (secret-bearing input is refused first).
  `
  CREATE TABLE tool_runs (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
    tool          TEXT NOT NULL,
    risk          TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
    source        TEXT NOT NULL CHECK (source IN ('text', 'voice')),
    summary       TEXT NOT NULL CHECK (length(summary) <= 300),
    decision      TEXT NOT NULL CHECK (decision IN ('auto', 'mandate', 'approved', 'denied', 'expired', 'blocked')),
    outcome       TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'skipped')),
    detail        TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 300),
    created_at    INTEGER NOT NULL,
    duration_ms   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX tool_runs_ws_created ON tool_runs(workspace_id, created_at);
  `,
]

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return row?.user_version ?? 0
}

/** Applies pending migrations, each atomically. Refuses to open a database from a newer app version. */
export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): number {
  const current = schemaVersion(db)
  if (current > migrations.length) {
    throw new Error(`Database schema v${current} is newer than this version of JARVIS supports (v${migrations.length}).`)
  }
  for (let v = current; v < migrations.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(migrations[v] ?? '')
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return migrations.length
}

/** Ensures the built-in workspaces exist (idempotent). */
export function seedWorkspaces(db: DatabaseSync, now: number = Date.now()): void {
  const insert = db.prepare('INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)')
  for (const w of WORKSPACES) insert.run(w.id, w.name, now)
}

/** Connection settings: durable writes, enforced foreign keys. */
export function configure(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 3000')
}
