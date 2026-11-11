process.env.TZ = 'America/Chicago'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSchedule, nextRun, validateWorkflowInput, workflowMessage, workflowTools, WORKFLOW_TEMPLATES } from '../src/shared/workflows.ts'
import { IpcValidationError } from '../src/shared/ipc.ts'
import { enabledTools } from '../src/shared/tools.ts'

const at = (s: string): number => new Date(s).getTime()
const MON_2055 = at('2026-11-09T20:55:00-06:00') // Monday evening
const weekdays730 = { days: [1, 2, 3, 4, 5], time: '07:30' }

test('next run: local time, skips past times and other days, crosses DST', () => {
  assert.equal(nextRun(weekdays730, MON_2055), at('2026-11-10T07:30:00-06:00'), 'Tuesday morning')
  assert.equal(nextRun(weekdays730, at('2026-11-13T08:00:00-06:00')), at('2026-11-16T07:30:00-06:00'), 'Friday after 7:30 → Monday')
  assert.equal(nextRun({ days: [1], time: '20:55' }, MON_2055), at('2026-11-16T20:55:00-06:00'), 'exactly now → next week')
  assert.equal(nextRun({ days: [0], time: '09:00' }, at('2027-03-13T12:00:00-06:00')), at('2027-03-14T09:00:00-05:00'), 'DST starts: still 9:00 local')
  assert.equal(nextRun(null, MON_2055), null)
})

test('schedule wording', () => {
  assert.match(describeSchedule(weekdays730, 'en-US'), /^Weekdays at 7:30\sAM$/)
  assert.match(describeSchedule({ days: [0, 1, 2, 3, 4, 5, 6], time: '18:00' }, 'en-US'), /^Every day at 6:00\sPM$/)
  assert.match(describeSchedule({ days: [1, 3], time: '09:05' }, 'en-US'), /^Mon, Wed at 9:05\sAM$/)
  assert.equal(describeSchedule(null), 'Run manually')
})

test('validation: names, instructions, schedules, secrets, unknown fields', () => {
  assert.deepEqual(validateWorkflowInput({ name: '  Morning  briefing ', instructions: 'Summarise my day please.', schedule: { days: [5, 1, 1], time: '07:30' }, enabled: true }), {
    name: 'Morning briefing',
    instructions: 'Summarise my day please.',
    schedule: { days: [1, 5], time: '07:30' },
    enabled: true,
  })
  const ok = { name: 'x', instructions: 'Do the thing every day.', schedule: null, enabled: true }
  assert.throws(() => validateWorkflowInput({ ...ok, name: '' }), /name/)
  assert.throws(() => validateWorkflowInput({ ...ok, instructions: 'short' }), /at least a sentence/)
  assert.throws(() => validateWorkflowInput({ ...ok, schedule: { days: [], time: '07:30' } }), /at least one day/)
  assert.throws(() => validateWorkflowInput({ ...ok, schedule: { days: [7], time: '07:30' } }), /day/)
  assert.throws(() => validateWorkflowInput({ ...ok, schedule: { days: [1], time: '7:30' } }), /HH:mm/)
  assert.throws(() => validateWorkflowInput({ ...ok, instructions: 'Use key sk-proj-abcdefghijklmnopqrstuvwx to call the API' }), /credentials/)
  assert.throws(() => validateWorkflowInput({ ...ok, owner: 'me' }), IpcValidationError)
  assert.throws(() => validateWorkflowInput({ ...ok, id: 'nope' }), /id/)
  for (const t of WORKFLOW_TEMPLATES) assert.doesNotThrow(() => validateWorkflowInput({ ...t, enabled: true }), t.name)
})

test('scheduled runs are read-only; manual runs keep normal tools', () => {
  const all = enabledTools([])
  const scheduled = workflowTools(all, 'schedule')
  assert.ok(scheduled.every((t) => t.risk === 'low'))
  assert.ok(scheduled.some((t) => t.name === 'delegate'), 'helpers are read-only, so allowed')
  assert.equal(scheduled.some((t) => t.name === 'save_memory' || t.name === 'set_reminder'), false)
  assert.equal(workflowTools(all, 'manual').length, all.length)
  const msg = workflowMessage({ name: 'Morning briefing', instructions: 'Do X.', now: MON_2055, trigger: 'schedule' })
  assert.match(msg, /^Run my saved routine "Morning briefing"\. It is now 2026-11-09T20:55-06:00\./)
  assert.match(msg, /read-only tools only/)
  assert.match(msg, /Routine instructions:\nDo X\.$/)
  assert.match(workflowMessage({ name: 'x', instructions: 'Do X.', now: MON_2055, trigger: 'manual' }), /I started this run myself/)
})
