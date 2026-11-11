import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TaskRegistry } from '../src/shared/taskRegistry.ts'
import type { RunningTask } from '../src/shared/ipc.ts'

test('registry: start, actions, end; changes are reported', () => {
  const seen: RunningTask[][] = []
  let t = 1000
  const reg = new TaskRegistry((l) => seen.push(l), () => t)
  const task = reg.start('typed', 'What are the open issues?')
  t = 2000
  const action = task.beginAction('github_list_issues', 'List GitHub issues')
  assert.deepEqual(reg.list()[0]?.actions, [{ id: action.id, tool: 'github_list_issues', title: 'List GitHub issues', startedAt: 2000 }])
  action.end()
  assert.deepEqual(reg.list()[0]?.actions, [])
  task.end()
  assert.deepEqual(reg.list(), [])
  assert.equal(seen.length, 4)
  assert.equal(reg.count('typed'), 0)
})

test('worker stop aborts one action; workflow stop aborts the task and all its actions', () => {
  const reg = new TaskRegistry()
  const task = reg.start('typed', 'x')
  const h1 = task.beginAction('delegate', 'Helper: repo A')
  const h2 = task.beginAction('delegate', 'Helper: repo B')
  assert.equal(reg.list()[0]?.actions.length, 2, 'two helpers side by side')
  assert.equal(reg.cancelAction(task.id, h2.id), true)
  assert.equal(h2.signal.aborted, true)
  assert.equal(h1.signal.aborted, false, 'the other helper carries on')
  assert.equal(task.signal.aborted, false, 'the request carries on')
  h2.end()
  assert.equal(reg.cancelAction(task.id, h2.id), false, 'already finished')
  assert.equal(reg.cancelAction(task.id), true, 'no id: the oldest running action')
  assert.equal(h1.signal.aborted, true)
  h1.end()
  const a3 = task.beginAction('get_time', 'Check the time')
  assert.equal(reg.cancel(task.id), true)
  assert.equal(task.signal.aborted, true)
  assert.equal(a3.signal.aborted, true, 'cancelling the task stops its actions')
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
  const c = reg.start('typed', 'y')
  const act = c.beginAction('get_time', 'Check the time')
  c.end()
  act.end()
  assert.equal(reg.list().length, 2)
})
