import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const schema = { workspaces, conversations, messages }
