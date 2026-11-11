import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { titleFrom, type ChatTurn, type ConversationSummary, type NewMessage, type StoredMessage, type WorkspaceId } from '../../shared/ipc.ts'
import { conversations, messages, schema } from './schema.ts'

// Conversation store. WORKSPACE ISOLATION IS ENFORCED HERE: every function takes the workspace and
// every query is scoped to it, so a conversation from another workspace is indistinguishable from
// one that doesn't exist. Main passes the active workspace from settings — never a renderer value.

export type Db = SqliteRemoteDatabase<typeof schema>

export class NotFoundError extends Error {
  constructor() {
    super('Conversation not found in this workspace.')
    this.name = 'NotFoundError'
  }
}

const now = (): number => Date.now()

async function owned(db: Db, ws: WorkspaceId, id: string): Promise<{ id: string; title: string } | null> {
  const rows = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, ws)))
    .limit(1)
  return rows[0] ?? null
}

export async function listConversations(db: Db, ws: WorkspaceId, limit = 100): Promise<ConversationSummary[]> {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      // Table-qualified on purpose: in a single-table select Drizzle renders ${'$'}{conversations.id} as a bare
      // "id", which inside this subquery would resolve to messages.id and always count 0.
      messageCount: sql<number>`(SELECT count(*) FROM messages m WHERE m.conversation_id = "conversations"."id")`,
    })
    .from(conversations)
    .where(eq(conversations.workspaceId, ws))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit)
}

export async function createConversation(db: Db, ws: WorkspaceId, title = 'New conversation'): Promise<string> {
  const id = crypto.randomUUID()
  const t = now()
  await db.insert(conversations).values({ id, workspaceId: ws, title, createdAt: t, updatedAt: t })
  return id
}

export async function getMessages(db: Db, ws: WorkspaceId, conversationId: string): Promise<StoredMessage[]> {
  if (!(await owned(db, ws, conversationId))) throw new NotFoundError()
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(sql`messages.rowid`))
}

/**
 * Appends a message. With conversationId null a new conversation is created and titled from
 * the first message. Returns the stored message (with its conversation id).
 */
export async function appendMessage(
  db: Db,
  ws: WorkspaceId,
  conversationId: string | null,
  m: NewMessage,
): Promise<StoredMessage> {
  let convId = conversationId
  let title: string
  if (convId === null) {
    title = titleFrom(m.text)
    convId = await createConversation(db, ws, title)
  } else {
    const c = await owned(db, ws, convId)
    if (!c) throw new NotFoundError()
    title = c.title
  }
  const t = now()
  const row: StoredMessage = { id: crypto.randomUUID(), conversationId: convId, role: m.role, text: m.text, via: m.via, createdAt: t }
  await db.insert(messages).values(row)
  const retitle = title === 'New conversation' && m.role === 'user'
  await db
    .update(conversations)
    .set(retitle ? { updatedAt: t, title: titleFrom(m.text) } : { updatedAt: t })
    .where(eq(conversations.id, convId))
  return row
}

/** Most recent turns, oldest first, for model context. */
export async function recentTurns(db: Db, ws: WorkspaceId, conversationId: string, limit = 20): Promise<ChatTurn[]> {
  if (!(await owned(db, ws, conversationId))) throw new NotFoundError()
  const rows = await db
    .select({ role: messages.role, text: messages.text })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(sql`messages.rowid`))
    .limit(limit)
  return rows.reverse()
}

/** Deletes a conversation and its messages. Returns false if it isn't in this workspace. */
export async function deleteConversation(db: Db, ws: WorkspaceId, conversationId: string): Promise<boolean> {
  if (!(await owned(db, ws, conversationId))) return false
  await db.delete(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, ws)))
  return true
}
