// Leads store through Drizzle on node:sqlite. Requires drizzle-orm (npm install).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/main/db/client.ts'
import { deleteLead, getLead, LeadNotFoundError, listLeads, saveLead } from '../src/main/db/leads.ts'
import { validateLeadInput } from '../src/shared/leads.ts'

const input = (name: string, o: Record<string, unknown> = {}) => validateLeadInput({ name, ...o })

test('create, update, order (open by next date, then won/lost), isolation, delete', async () => {
  const { db, close } = openDatabase(':memory:')
  const a = await saveLead(db, 'personal', input('Ada', { status: 'qualified', nextDate: '2026-11-20' }))
  await saveLead(db, 'personal', input('Bob', { status: 'won' }))
  await saveLead(db, 'personal', input('Cy', { status: 'new', nextDate: '2026-11-12' }))
  await saveLead(db, 'personal', input('Di', { status: 'contacted' }))
  assert.deepEqual((await listLeads(db, 'personal')).map((l) => l.name), ['Cy', 'Ada', 'Di', 'Bob'])
  const updated = await saveLead(db, 'personal', { ...input('Ada', { status: 'proposal', value: 900 }), id: a.id })
  assert.equal(updated.status, 'proposal')
  assert.equal(updated.value, 900)
  assert.deepEqual(await listLeads(db, 'research'), [])
  await assert.rejects(getLead(db, 'research', a.id), LeadNotFoundError)
  await assert.rejects(deleteLead(db, 'research', a.id), LeadNotFoundError)
  await deleteLead(db, 'personal', a.id)
  assert.equal((await listLeads(db, 'personal')).length, 3)
  close()
})
