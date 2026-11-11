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
  // 4 — reminders (Sprint 10). Fired only while the app runs; see shared/reminders.ts for the lifecycle.
  `
  CREATE TABLE reminders (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
    text          TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
    due_at        INTEGER NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('pending', 'fired', 'missed', 'dismissed', 'cancelled')),
    source        TEXT NOT NULL CHECK (source IN ('user', 'assistant')),
    created_at    INTEGER NOT NULL,
    fired_at      INTEGER
  );
  CREATE INDEX reminders_status_due ON reminders(status, due_at);
  CREATE INDEX reminders_ws_due ON reminders(workspace_id, due_at);
  `,
  // 5 — workflows (Sprint 13): saved routines and their runs (last 20 kept per routine).
  `
  CREATE TABLE workflows (
    id             TEXT PRIMARY KEY,
    workspace_id   TEXT NOT NULL REFERENCES workspaces(id),
    name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    instructions   TEXT NOT NULL CHECK (length(instructions) BETWEEN 10 AND 2000),
    schedule_days  TEXT CHECK (schedule_days IS NULL OR schedule_days GLOB '[0-6]*'),
    schedule_time  TEXT CHECK (schedule_time IS NULL OR schedule_time GLOB '[01][0-9]:[0-5][0-9]' OR schedule_time GLOB '2[0-3]:[0-5][0-9]'),
    enabled        INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    next_run_at    INTEGER,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    CHECK ((schedule_days IS NULL) = (schedule_time IS NULL))
  );
  CREATE INDEX workflows_ws ON workflows(workspace_id, name);
  CREATE INDEX workflows_due ON workflows(enabled, next_run_at);
  CREATE TABLE workflow_runs (
    id           TEXT PRIMARY KEY,
    workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    trigger      TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule')),
    status       TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error', 'cancelled')),
    started_at   INTEGER NOT NULL,
    finished_at  INTEGER,
    output       TEXT NOT NULL DEFAULT '' CHECK (length(output) <= 4000),
    actions      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX workflow_runs_wf ON workflow_runs(workflow_id, started_at);
  `,
  // 6 — leads (Sprint 15): a small local pipeline per workspace.
  `
  CREATE TABLE leads (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
    name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    company       TEXT NOT NULL DEFAULT '' CHECK (length(company) <= 80),
    email         TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 120),
    status        TEXT NOT NULL CHECK (status IN ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost')),
    value         INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
    notes         TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
    next_step     TEXT NOT NULL DEFAULT '' CHECK (length(next_step) <= 200),
    next_date     TEXT CHECK (next_date IS NULL OR next_date GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX leads_ws_status ON leads(workspace_id, status);
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
  // With WAL, NORMAL is the recommended pairing: no corruption risk, far fewer disk syncs
  // (a power cut can lose only the last moments of writes, never the database). Sprint 16.
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 3000')
}

/** Lets SQLite refresh its query-planner statistics where useful; cheap, run when closing. */
export function optimize(db: DatabaseSync): void {
  try {
    db.exec('PRAGMA optimize')
  } catch {
    // Best effort: never block closing the app.
  }
}
