// Reminder store through Drizzle on node:sqlite. Requires drizzle-orm (npm install).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/main/db/client.ts'
import {
  addReminder,
  cancelReminder,
  dismissReminder,
  listReminders,
  markFired,
  markMissed,
  pendingDue,
  ReminderNotFoundError,
  snoozeReminder,
} from '../src/main/db/reminders.ts'

test('lifecycle: pending → fired → snoozed → fired → dismissed; cancel only while pending', async () => {
  const { db, close } = openDatabase(':memory:')
  const a = await addReminder(db, 'personal', { text: 'Call Acme', dueAt: 100, source: 'assistant' })
  const b = await addReminder(db, 'personal', { text: 'Later', dueAt: 10_000, source: 'user' })
  assert.deepEqual((await pendingDue(db, 150)).map((r) => r.id), [a.id])
  await markFired(db, [a.id], 150)
  assert.deepEqual((await pendingDue(db, 150)).map((r) => r.id), [])
  const listed = await listReminders(db, 'personal')
  assert.deepEqual(listed.map((r) => [r.text, r.status]), [['Call Acme', 'fired'], ['Later', 'pending']])
  await assert.rejects(cancelReminder(db, 'personal', a.id), ReminderNotFoundError, 'fired ones are dismissed, not cancelled')
  await snoozeReminder(db, 'personal', a.id, 700)
  assert.deepEqual((await pendingDue(db, 700)).map((r) => r.id), [a.id])
  await markFired(db, [a.id], 700)
  await dismissReminder(db, 'personal', a.id)
  assert.equal((await cancelReminder(db, 'personal', b.id)).status, 'cancelled')
  assert.deepEqual(await listReminders(db, 'personal'), [])
  close()
})

test('workspace isolation and missed reminders', async () => {
  const { db, close } = openDatabase(':memory:')
  const r = await addReminder(db, 'research', { text: 'Read paper', dueAt: 50, source: 'user' })
  await assert.rejects(cancelReminder(db, 'personal', r.id), ReminderNotFoundError)
  assert.deepEqual(await listReminders(db, 'personal'), [])
  await markMissed(db, [r.id])
  assert.equal((await listReminders(db, 'research'))[0]?.status, 'missed')
  await markFired(db, [r.id], 60) // only pending ones change
  assert.equal((await listReminders(db, 'research'))[0]?.status, 'missed')
  close()
})
