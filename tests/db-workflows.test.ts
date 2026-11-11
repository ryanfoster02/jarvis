// Workflow store through Drizzle on node:sqlite. Requires drizzle-orm (npm install).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/main/db/client.ts'
import {
  closeStaleRuns,
  deleteWorkflow,
  dueWorkflows,
  finishRun,
  listRuns,
  listWorkflows,
  rescheduleAll,
  saveWorkflow,
  startRun,
  WorkflowNotFoundError,
} from '../src/main/db/workflows.ts'
import { KEEP_RUNS } from '../src/shared/workflows.ts'

const input = { name: 'Morning briefing', instructions: 'Summarise my day please.', schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: '07:30' }, enabled: true }

test('save, schedule, due, runs (trimmed), delete cascades; workspace isolation', async () => {
  const { db, close } = openDatabase(':memory:')
  const w = await saveWorkflow(db, 'personal', input, 0)
  assert.ok(w.nextRunAt !== null && w.nextRunAt > 0)
  assert.deepEqual((await listWorkflows(db, 'research')).length, 0)
  await assert.rejects(deleteWorkflow(db, 'research', w.id), WorkflowNotFoundError)
  assert.deepEqual((await dueWorkflows(db, (w.nextRunAt ?? 0) + 1)).map((x) => x.id), [w.id])
  const off = await saveWorkflow(db, 'personal', { ...input, id: w.id, enabled: false })
  assert.equal(off.nextRunAt, null)
  assert.deepEqual(await dueWorkflows(db, Number.MAX_SAFE_INTEGER), [])
  for (let i = 0; i < KEEP_RUNS + 3; i++) {
    const r = await startRun(db, w.id, 'manual', i)
    await finishRun(db, r, { status: 'ok', output: `run ${i}`, actions: 1 }, i + 1)
  }
  const runs = await listRuns(db, 'personal', w.id)
  assert.equal(runs.length, KEEP_RUNS)
  assert.equal(runs[0]?.output, `run ${KEEP_RUNS + 2}`)
  assert.equal((await listWorkflows(db, 'personal'))[0]?.lastRun?.output, `run ${KEEP_RUNS + 2}`)
  await deleteWorkflow(db, 'personal', w.id)
  assert.deepEqual(await listWorkflows(db, 'personal'), [])
  close()
})

test('startup: stale runs closed, schedules recomputed from now', async () => {
  const { db, close } = openDatabase(':memory:')
  const w = await saveWorkflow(db, 'personal', input, 0)
  await startRun(db, w.id, 'schedule', 5)
  await closeStaleRuns(db, 10)
  assert.equal((await listRuns(db, 'personal', w.id))[0]?.status, 'cancelled')
  const now = Date.now()
  await rescheduleAll(db, now)
  const after = (await listWorkflows(db, 'personal'))[0]
  assert.ok((after?.nextRunAt ?? 0) > now, 'no catch-up for times missed while closed')
  close()
})
