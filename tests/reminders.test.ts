// Times are checked in a fixed zone so "today/tomorrow" and local parsing are deterministic.
process.env.TZ = 'America/Chicago'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueReminders, formatWhen, localIso, parseWhen, STARTUP_GRACE_MS, sweepOnStartup, validateReminderText } from '../src/shared/reminders.ts'
import { DEFAULT_SETTINGS, IpcValidationError, validateSettingsPatch, type Reminder } from '../src/shared/ipc.ts'
import { decide } from '../src/shared/permissions.ts'
import { parseToolArgs, summarizeToolCall, ToolArgsError, TOOLS } from '../src/shared/tools.ts'

const NOW = new Date('2026-11-09T20:55:00-06:00').getTime() // Mon 9 Nov 2026, 8:55 PM in Chicago
const r = (id: string, dueAt: number, status: Reminder['status'] = 'pending'): Reminder => ({
  id,
  workspaceId: 'personal',
  text: id,
  dueAt,
  status,
  source: 'user',
  createdAt: 0,
  firedAt: null,
})

test('parseWhen: local times, offsets, epoch; past and far-future refused', () => {
  assert.equal(parseWhen('2026-11-10T09:30', NOW), new Date('2026-11-10T09:30:00-06:00').getTime(), 'no offset = local time')
  assert.equal(parseWhen('2026-11-10T15:30Z', NOW), Date.UTC(2026, 10, 10, 15, 30))
  assert.equal(parseWhen(NOW + 60_000, NOW), NOW + 60_000)
  assert.equal(parseWhen(NOW - 30_000, NOW), NOW, 'a few seconds late rounds up to now')
  assert.throws(() => parseWhen('2026-11-09T08:00', NOW), /already passed/)
  assert.throws(() => parseWhen('2028-01-01T00:00', NOW), /a year ahead/)
  assert.throws(() => parseWhen('tomorrow at 9', NOW), IpcValidationError)
  assert.throws(() => parseWhen('2026-02-30T09:00', NOW), IpcValidationError)
})

test('text: trimmed, bounded, no secrets', () => {
  assert.equal(validateReminderText('  Call   Acme '), 'Call Acme')
  assert.throws(() => validateReminderText(''), /empty/)
  assert.throws(() => validateReminderText('x'.repeat(301)), /300/)
  assert.throws(() => validateReminderText('my password is hunter22'), /credentials/)
})

test('due and startup sweep: recent ones fire, older ones are marked missed', () => {
  const list = [r('later', NOW + 1000), r('just', NOW - 30_000), r('old', NOW - STARTUP_GRACE_MS - 1), r('done', NOW - 5000, 'fired')]
  assert.deepEqual(dueReminders(list, NOW).map((x) => x.id), ['old', 'just'])
  const s = sweepOnStartup(list, NOW)
  assert.deepEqual(s.fire.map((x) => x.id), ['just'])
  assert.deepEqual(s.missed.map((x) => x.id), ['old'])
})

test('formatting for people and for the model', () => {
  assert.match(formatWhen(new Date('2026-11-09T21:30:00-06:00').getTime(), NOW, 'en-US'), /^today 9:30\sPM$/)
  assert.match(formatWhen(new Date('2026-11-10T08:00:00-06:00').getTime(), NOW, 'en-US'), /^tomorrow 8:00\sAM$/)
  assert.match(formatWhen(new Date('2026-11-12T09:00:00-06:00').getTime(), NOW, 'en-US'), /^Thu, Nov 12, 9:00\sAM$/)
  assert.match(formatWhen(new Date('2027-01-04T09:00:00-06:00').getTime(), NOW, 'en-US'), /2027/)
  assert.equal(localIso(new Date('2026-11-10T09:30:00-06:00').getTime()), '2026-11-10T09:30-06:00')
})

test('tools: set asks (or runs under the mandate), cancel always asks, args validated', () => {
  assert.deepEqual(parseToolArgs('set_reminder', { text: 'Call Acme', when: '2026-11-10T09:30' }, NOW), {
    text: 'Call Acme',
    dueAt: new Date('2026-11-10T09:30:00-06:00').getTime(),
  })
  assert.throws(() => parseToolArgs('set_reminder', { text: 'x', when: '2020-01-01T00:00' }, NOW), ToolArgsError)
  assert.throws(() => parseToolArgs('set_reminder', { text: 'x', when: '2026-11-10T09:30', repeat: 'daily' }, NOW), /Unexpected/)
  assert.throws(() => parseToolArgs('cancel_reminder', { id: 'abc' }, NOW), /reminder ID/)
  const all = ['reminders:read', 'reminders:write', 'reminders:cancel'] as const
  const ctx = { halted: false, disabled: [], grantedScopes: all, mandates: [] }
  assert.equal(decide(TOOLS.list_reminders, ctx).kind, 'allow')
  assert.equal(decide(TOOLS.set_reminder, ctx).kind, 'ask')
  assert.deepEqual(decide(TOOLS.set_reminder, { ...ctx, mandates: ['reminders:write'] }), { kind: 'allow', decision: 'mandate' })
  assert.equal(decide(TOOLS.cancel_reminder, { ...ctx, mandates: ['reminders:write'] }).kind, 'ask', 'the mandate covers setting, not cancelling')
  assert.match(
    summarizeToolCall('set_reminder', { text: 'Call Acme', dueAt: new Date('2026-11-10T09:30:00-06:00').getTime() }, { now: NOW }),
    /^Remind you tomorrow 9:30\sAM: "Call Acme"$/,
  )
})

test('settings: reminder mandate off and notifications on by default', () => {
  assert.equal(DEFAULT_SETTINGS.autoSetReminders, false)
  assert.equal(DEFAULT_SETTINGS.reminderNotifications, true)
  assert.deepEqual(validateSettingsPatch({ autoSetReminders: true, reminderNotifications: false }), { autoSetReminders: true, reminderNotifications: false })
  assert.throws(() => validateSettingsPatch({ reminderNotifications: 'yes' }), IpcValidationError)
})
