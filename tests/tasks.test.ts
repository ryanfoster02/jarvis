import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TaskRegistry } from '../src/shared/taskRegistry.ts'
import type { RunningTask } from '../src/shared/ipc.ts'

test('registry: start, action, end; changes are reported', () => {
  const seen: RunningTask[][] = []
  let t = 1000
  const reg = new TaskRegistry((l) => seen.push(l), () => t)
  const task = reg.start('typed', 'What are the open issues?')
  t = 2000
  const action = task.beginAction('github_list_issues', 'List GitHub issues')
  assert.deepEqual(reg.list()[0]?.action, { tool: 'github_list_issues', title: 'List GitHub issues', startedAt: 2000 })
  action.end()
  assert.equal(reg.list()[0]?.action, null)
  task.end()
  assert.deepEqual(reg.list(), [])
  assert.equal(seen.length, 4)
  assert.equal(reg.count('typed'), 0)
})

test('worker stop aborts only the action; workflow stop aborts the task and its action', () => {
  const reg = new TaskRegistry()
  const task = reg.start('typed', 'x')
  const a1 = task.beginAction('save_memory', 'Save a memory')
  assert.equal(reg.cancelAction(task.id), true)
  assert.equal(a1.signal.aborted, true)
  assert.equal(task.signal.aborted, false, 'the request carries on')
  a1.end()
  assert.equal(reg.cancelAction(task.id), false, 'nothing running now')
  const a2 = task.beginAction('get_time', 'Check the time')
  assert.equal(reg.cancel(task.id), true)
  assert.equal(task.signal.aborted, true)
  assert.equal(a2.signal.aborted, true, 'cancelling the task stops its action')
  assert.equal(reg.cancel(task.id), false, 'already cancelled')
  assert.equal(reg.cancel('nope'), false)
})

test('Stop all cancels every task; titles are clipped', () => {
  const reg = new TaskRegistry()
  const a = reg.start('typed', 'q'.repeat(200))
  const b = reg.start('voice', 'Voice request')
  assert.equal(reg.list()[0]?.title.length, 80)
  reg.cancelAll()
  assert.ok(a.signal.aborted && b.signal.aborted)
  // A stale action handle ending later doesn't resurrect anything.
  const c = reg.start('typed', 'y')
  const act = c.beginAction('get_time', 'Check the time')
  c.end()
  act.end()
  assert.equal(reg.list().length, 2)
})
