import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { REMINDER_STATUSES, RISK_LEVELS, TOOL_NAMES, type WorkspaceId } from '../../shared/ipc.ts'

// Drizzle table definitions — typed queries. The SQL that creates them lives in migrations.ts.

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    title: text('title').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('conversations_ws_updated').on(t.workspaceId, t.updatedAt)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    text: text('text').notNull(),
    via: text('via', { enum: ['text', 'voice'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('messages_conversation_created').on(t.conversationId, t.createdAt)],
)

export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: ['global', 'workspace'] }).notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    text: text('text').notNull(),
    source: text('source', { enum: ['user', 'conversation'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('memories_scope_ws_updated').on(t.scope, t.workspaceId, t.updatedAt)],
)

export const toolRuns = sqliteTable(
  'tool_runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    tool: text('tool', { enum: TOOL_NAMES }).notNull(),
    risk: text('risk', { enum: RISK_LEVELS }).notNull(),
    source: text('source', { enum: ['text', 'voice'] }).notNull(),
    summary: text('summary').notNull(),
    decision: text('decision', { enum: ['auto', 'mandate', 'approved', 'denied', 'expired', 'blocked'] }).notNull(),
    outcome: text('outcome', { enum: ['ok', 'error', 'skipped'] }).notNull(),
    detail: text('detail').notNull(),
    createdAt: integer('created_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [index('tool_runs_ws_created').on(t.workspaceId, t.createdAt)],
)

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .$type<WorkspaceId>()
      .notNull()
      .references(() => workspaces.id),
    text: text('text').notNull(),
    dueAt: integer('due_at').notNull(),
    status: text('status', { enum: REMINDER_STATUSES }).notNull(),
    source: text('source', { enum: ['user', 'assistant'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    firedAt: integer('fired_at'),
  },
  (t) => [index('reminders_status_due').on(t.status, t.dueAt), index('reminders_ws_due').on(t.workspaceId, t.dueAt)],
)

export const schema = { workspaces, conversations, messages, memories, toolRuns, reminders }
