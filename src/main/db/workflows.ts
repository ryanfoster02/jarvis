import { and, desc, eq, inArray, lte, notInArray } from 'drizzle-orm'
import type { Workflow, WorkflowInput, WorkflowRun, WorkflowSchedule, WorkspaceId } from '../../shared/ipc.ts'
import { clipOutput, KEEP_RUNS, MAX_WORKFLOWS, nextRun } from '../../shared/workflows.ts'
import type { Db } from './conversations.ts'
import { workflowRuns, workflows } from './schema.ts'

// Saved routines. Owner functions are scoped to a workspace (others behave as not found);
// the workflow scheduler alone reads across workspaces to find what is due.

export class WorkflowNotFoundError extends Error {
  constructor() {
    super('Routine not found in this workspace.')
    this.name = 'WorkflowNotFoundError'
  }
}
export class WorkflowLimitError extends Error {
  constructor() {
    super(`You have ${MAX_WORKFLOWS} routines here. Delete one before adding another.`)
    this.name = 'WorkflowLimitError'
  }
}

type Row = typeof workflows.$inferSelect

const toSchedule = (r: Row): WorkflowSchedule | null =>
  r.scheduleDays !== null && r.scheduleTime !== null
    ? { days: r.scheduleDays.split(',').map(Number), time: r.scheduleTime }
    : null

async function lastRuns(db: Db, ids: string[]): Promise<Map<string, WorkflowRun>> {
  const map = new Map<string, WorkflowRun>()
  if (!ids.length) return map
  const rows = await db.select().from(workflowRuns).where(inArray(workflowRuns.workflowId, ids)).orderBy(desc(workflowRuns.startedAt))
  for (const r of rows) if (!map.has(r.workflowId)) map.set(r.workflowId, r)
  return map
}

const toWorkflow = (r: Row, last: WorkflowRun | null): Workflow => ({
  id: r.id,
  workspaceId: r.workspaceId,
  name: r.name,
  instructions: r.instructions,
  schedule: toSchedule(r),
  enabled: r.enabled,
  nextRunAt: r.nextRunAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  lastRun: last,
})

export async function listWorkflows(db: Db, ws: WorkspaceId): Promise<Workflow[]> {
  const rows = await db.select().from(workflows).where(eq(workflows.workspaceId, ws)).orderBy(workflows.name)
  const last = await lastRuns(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((r) => toWorkflow(r, last.get(r.id) ?? null))
}

export async function getWorkflow(db: Db, ws: WorkspaceId, id: string): Promise<Workflow> {
  const rows = await db.select().from(workflows).where(and(eq(workflows.id, id), eq(workflows.workspaceId, ws))).limit(1)
  const r = rows[0]
  if (!r) throw new WorkflowNotFoundError()
  return toWorkflow(r, (await lastRuns(db, [id])).get(id) ?? null)
}

/** Create (no id) or update (id) a routine. Recomputes its next scheduled time. */
export async function saveWorkflow(db: Db, ws: WorkspaceId, input: WorkflowInput, now = Date.now()): Promise<Workflow> {
  const values = {
    name: input.name,
    instructions: input.instructions,
    scheduleDays: input.schedule ? input.schedule.days.join(',') : null,
    scheduleTime: input.schedule ? input.schedule.time : null,
    enabled: input.enabled,
    nextRunAt: input.enabled ? nextRun(input.schedule, now) : null,
    updatedAt: now,
  }
  if (input.id) {
    await getWorkflow(db, ws, input.id) // scoped existence check
    await db.update(workflows).set(values).where(eq(workflows.id, input.id))
    return getWorkflow(db, ws, input.id)
  }
  const count = (await db.select({ id: workflows.id }).from(workflows).where(eq(workflows.workspaceId, ws))).length
  if (count >= MAX_WORKFLOWS) throw new WorkflowLimitError()
  const id = crypto.randomUUID()
  await db.insert(workflows).values({ id, workspaceId: ws, createdAt: now, ...values })
  return getWorkflow(db, ws, id)
}

export async function deleteWorkflow(db: Db, ws: WorkspaceId, id: string): Promise<void> {
  await getWorkflow(db, ws, id)
  await db.delete(workflows).where(eq(workflows.id, id)) // runs cascade
}

export async function listRuns(db: Db, ws: WorkspaceId, workflowId: string): Promise<WorkflowRun[]> {
  await getWorkflow(db, ws, workflowId)
  return db.select().from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId)).orderBy(desc(workflowRuns.startedAt)).limit(KEEP_RUNS)
}

export async function startRun(db: Db, workflowId: string, trigger: WorkflowRun['trigger'], now = Date.now()): Promise<WorkflowRun> {
  const run: WorkflowRun = { id: crypto.randomUUID(), workflowId, trigger, status: 'running', startedAt: now, finishedAt: null, output: '', actions: 0 }
  await db.insert(workflowRuns).values(run)
  return run
}

export async function finishRun(
  db: Db,
  run: WorkflowRun,
  result: { status: Exclude<WorkflowRun['status'], 'running'>; output: string; actions: number },
  now = Date.now(),
): Promise<WorkflowRun> {
  const done: WorkflowRun = { ...run, ...result, output: clipOutput(result.output), finishedAt: now }
  await db.update(workflowRuns).set({ status: done.status, output: done.output, actions: done.actions, finishedAt: now }).where(eq(workflowRuns.id, run.id))
  // Keep only the newest KEEP_RUNS per routine.
  const keep = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, run.workflowId))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(KEEP_RUNS)
  await db.delete(workflowRuns).where(
    and(
      eq(workflowRuns.workflowId, run.workflowId),
      notInArray(
        workflowRuns.id,
        keep.map((k) => k.id),
      ),
    ),
  )
  return done
}

// ---------- Scheduler (all workspaces) ----------

export async function dueWorkflows(db: Db, now: number): Promise<Workflow[]> {
  const rows = await db.select().from(workflows).where(and(eq(workflows.enabled, true), lte(workflows.nextRunAt, now)))
  return rows.map((r) => toWorkflow(r, null))
}

/** Advance a routine's next run (after it ran, or at startup: no catch-up for times missed while closed). */
export async function rescheduleFrom(db: Db, id: string, schedule: WorkflowSchedule | null, after: number): Promise<number | null> {
  const next = nextRun(schedule, after)
  await db.update(workflows).set({ nextRunAt: next }).where(eq(workflows.id, id))
  return next
}

/** At startup: recompute every enabled routine's next run from now. */
export async function rescheduleAll(db: Db, now: number): Promise<void> {
  const rows = await db.select().from(workflows).where(eq(workflows.enabled, true))
  for (const r of rows) await rescheduleFrom(db, r.id, toSchedule(r), now)
}

/** Runs left "running" by a crash or quit are closed as cancelled at startup. */
export async function closeStaleRuns(db: Db, now: number): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ status: 'cancelled', finishedAt: now, output: 'Stopped: JARVIS quit before this run finished.' })
    .where(eq(workflowRuns.status, 'running'))
}
