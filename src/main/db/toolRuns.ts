import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { ToolRun, WorkspaceId } from '../../shared/ipc.ts'
import type { Db } from './conversations.ts'
import { toolRuns } from './schema.ts'

// Action log (SECURITY.md §6). Scoped like everything else: a workspace only sees its own runs.
// Kept to the newest MAX_RUNS_PER_WORKSPACE rows per workspace.

export const MAX_RUNS_PER_WORKSPACE = 500

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export async function logToolRun(db: Db, ws: WorkspaceId, run: Omit<ToolRun, 'id' | 'createdAt'> & { createdAt?: number }): Promise<ToolRun> {
  const row: ToolRun = {
    ...run,
    id: crypto.randomUUID(),
    summary: clip(run.summary, 300),
    detail: clip(run.detail, 300),
    createdAt: run.createdAt ?? Date.now(),
    durationMs: Math.max(0, Math.round(run.durationMs)),
  }
  await db.insert(toolRuns).values({ ...row, workspaceId: ws })
  // Trim: drop anything older than the newest MAX_RUNS_PER_WORKSPACE for this workspace.
  const cutoff = await db
    .select({ createdAt: toolRuns.createdAt })
    .from(toolRuns)
    .where(eq(toolRuns.workspaceId, ws))
    .orderBy(desc(toolRuns.createdAt))
    .limit(1)
    .offset(MAX_RUNS_PER_WORKSPACE - 1)
  const oldest = cutoff[0]?.createdAt
  if (oldest !== undefined) await db.delete(toolRuns).where(and(eq(toolRuns.workspaceId, ws), lt(toolRuns.createdAt, oldest)))
  return row
}

export async function listToolRuns(db: Db, ws: WorkspaceId, limit = 50): Promise<ToolRun[]> {
  return db
    .select({
      id: toolRuns.id,
      tool: toolRuns.tool,
      risk: toolRuns.risk,
      source: toolRuns.source,
      summary: toolRuns.summary,
      decision: toolRuns.decision,
      outcome: toolRuns.outcome,
      detail: toolRuns.detail,
      createdAt: toolRuns.createdAt,
      durationMs: toolRuns.durationMs,
    })
    .from(toolRuns)
    .where(eq(toolRuns.workspaceId, ws))
    .orderBy(desc(toolRuns.createdAt), desc(sql`rowid`))
    .limit(limit)
}
