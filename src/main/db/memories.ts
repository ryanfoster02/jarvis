import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import type { Memory, MemoryScope, WorkspaceId } from '../../shared/ipc.ts'
import { MAX_MEMORIES_PER_SCOPE } from '../../shared/memory.ts'
import type { Db } from './conversations.ts'
import { memories } from './schema.ts'

// Memory store. Same isolation rule as conversations: from a workspace you can see and change
// global memories plus that workspace's own — another workspace's memories behave as not found.

export class MemoryNotFoundError extends Error {
  constructor() {
    super('Memory not found in this workspace.')
    this.name = 'MemoryNotFoundError'
  }
}

export class MemoryLimitError extends Error {
  constructor() {
    super(`You've reached ${MAX_MEMORIES_PER_SCOPE} memories here. Delete some before adding more.`)
    this.name = 'MemoryLimitError'
  }
}

const visibleFrom = (ws: WorkspaceId) =>
  or(and(eq(memories.scope, 'global'), isNull(memories.workspaceId)), and(eq(memories.scope, 'workspace'), eq(memories.workspaceId, ws)))

/** Global + this workspace's memories, newest first. */
export async function listMemories(db: Db, ws: WorkspaceId): Promise<Memory[]> {
  return db.select().from(memories).where(visibleFrom(ws)).orderBy(desc(memories.updatedAt), desc(sql`memories.rowid`))
}

export async function addMemory(
  db: Db,
  ws: WorkspaceId,
  input: { scope: MemoryScope; text: string; source: Memory['source'] },
): Promise<Memory> {
  const workspaceId = input.scope === 'workspace' ? ws : null
  const [counted] = await db
    .select({ n: sql<number>`count(*)` })
    .from(memories)
    .where(workspaceId === null ? eq(memories.scope, 'global') : and(eq(memories.scope, 'workspace'), eq(memories.workspaceId, workspaceId)))
  if ((counted?.n ?? 0) >= MAX_MEMORIES_PER_SCOPE) throw new MemoryLimitError()
  const t = Date.now()
  const row: Memory = { id: crypto.randomUUID(), scope: input.scope, workspaceId, text: input.text, source: input.source, createdAt: t, updatedAt: t }
  await db.insert(memories).values(row)
  return row
}

async function visible(db: Db, ws: WorkspaceId, id: string): Promise<Memory | null> {
  const rows = await db.select().from(memories).where(and(eq(memories.id, id), visibleFrom(ws))).limit(1)
  return rows[0] ?? null
}

export async function updateMemory(db: Db, ws: WorkspaceId, id: string, text: string): Promise<Memory> {
  const m = await visible(db, ws, id)
  if (!m) throw new MemoryNotFoundError()
  const updatedAt = Date.now()
  await db.update(memories).set({ text, updatedAt }).where(eq(memories.id, id))
  return { ...m, text, updatedAt }
}

export async function deleteMemory(db: Db, ws: WorkspaceId, id: string): Promise<boolean> {
  if (!(await visible(db, ws, id))) return false
  await db.delete(memories).where(eq(memories.id, id))
  return true
}

/** Texts for the prompt, newest first, split by scope. */
export async function memoriesForPrompt(db: Db, ws: WorkspaceId): Promise<{ global: string[]; workspace: string[] }> {
  const rows = await listMemories(db, ws)
  return {
    global: rows.filter((m) => m.scope === 'global').map((m) => m.text),
    workspace: rows.filter((m) => m.scope === 'workspace').map((m) => m.text),
  }
}

/** Everything, every workspace — for the owner's export file. */
export async function allMemories(db: Db): Promise<Memory[]> {
  return db.select().from(memories).orderBy(memories.scope, memories.workspaceId, desc(memories.updatedAt))
}
