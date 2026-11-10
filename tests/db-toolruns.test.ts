// Action log through Drizzle on node:sqlite. Requires drizzle-orm (npm install).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/main/db/client.ts'
import { listToolRuns, logToolRun, MAX_RUNS_PER_WORKSPACE } from '../src/main/db/toolRuns.ts'

const run = (summary: string, createdAt: number) =>
  ({ tool: 'save_memory', risk: 'medium', source: 'text', summary, decision: 'approved', outcome: 'ok', detail: '', durationMs: 4, createdAt }) as const

test('runs are logged per workspace, newest first, and clipped', async () => {
  const { db, close } = openDatabase(':memory:')
  await logToolRun(db, 'personal', run('first', 1))
  await logToolRun(db, 'personal', { ...run('second', 2), detail: 'd'.repeat(400) })
  await logToolRun(db, 'research', run('elsewhere', 3))
  const mine = await listToolRuns(db, 'personal')
  assert.deepEqual(mine.map((r) => r.summary), ['second', 'first'])
  assert.equal(mine[0]?.detail.length, 300)
  assert.deepEqual((await listToolRuns(db, 'research')).map((r) => r.summary), ['elsewhere'])
  close()
})

test('log is trimmed to the newest rows per workspace', async () => {
  const { db, close } = openDatabase(':memory:')
  for (let i = 0; i < MAX_RUNS_PER_WORKSPACE + 5; i++) await logToolRun(db, 'development', run(`r${i}`, i))
  const all = await listToolRuns(db, 'development', 1000)
  assert.equal(all.length, MAX_RUNS_PER_WORKSPACE)
  assert.equal(all.at(-1)?.summary, 'r5')
  close()
})
