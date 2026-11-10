// Memory store through Drizzle on node:sqlite. Requires drizzle-orm (npm install).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/main/db/client.ts'
import { addMemory, allMemories, deleteMemory, listMemories, MemoryLimitError, MemoryNotFoundError, memoriesForPrompt, updateMemory } from '../src/main/db/memories.ts'
import { MAX_MEMORIES_PER_SCOPE } from '../src/shared/memory.ts'

test('global memories are visible everywhere; workspace memories only at home', async () => {
  const { db, close } = openDatabase(':memory:')
  await addMemory(db, 'personal', { scope: 'global', text: 'Owner is Ryan', source: 'user' })
  await addMemory(db, 'foster-automation', { scope: 'workspace', text: 'Acme renews in March', source: 'user' })
  assert.deepEqual((await listMemories(db, 'research')).map((m) => m.text), ['Owner is Ryan'])
  const fa = await memoriesForPrompt(db, 'foster-automation')
  assert.deepEqual(fa, { global: ['Owner is Ryan'], workspace: ['Acme renews in March'] })
  close()
})

test('another workspace cannot edit or delete a workspace memory; global ones are editable anywhere', async () => {
  const { db, close } = openDatabase(':memory:')
  const ws = await addMemory(db, 'client-projects', { scope: 'workspace', text: 'Client budget is 20k', source: 'user' })
  const g = await addMemory(db, 'client-projects', { scope: 'global', text: 'Prefers mornings', source: 'user' })
  await assert.rejects(updateMemory(db, 'personal', ws.id, 'changed'), MemoryNotFoundError)
  assert.equal(await deleteMemory(db, 'personal', ws.id), false)
  assert.equal((await updateMemory(db, 'personal', g.id, 'Prefers early mornings')).text, 'Prefers early mornings')
  assert.equal(await deleteMemory(db, 'client-projects', ws.id), true)
  assert.deepEqual((await allMemories(db)).map((m) => m.text), ['Prefers early mornings'])
  close()
})

test('newest first, and the per-scope limit is enforced', async () => {
  const { db, close } = openDatabase(':memory:')
  await addMemory(db, 'development', { scope: 'workspace', text: 'first', source: 'user' })
  await new Promise((r) => setTimeout(r, 3))
  await addMemory(db, 'development', { scope: 'workspace', text: 'second', source: 'conversation' })
  assert.deepEqual((await listMemories(db, 'development')).map((m) => m.text), ['second', 'first'])
  for (let i = 2; i < MAX_MEMORIES_PER_SCOPE; i++) await addMemory(db, 'development', { scope: 'workspace', text: `m${i}`, source: 'user' })
  await assert.rejects(addMemory(db, 'development', { scope: 'workspace', text: 'one too many', source: 'user' }), MemoryLimitError)
  await addMemory(db, 'research', { scope: 'workspace', text: 'other workspace has its own limit', source: 'user' })
  close()
})
