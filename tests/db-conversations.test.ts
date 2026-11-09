// Conversation store through Drizzle (sqlite-proxy) on node:sqlite. Requires drizzle-orm (npm install).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/main/db/client.ts'
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getMessages,
  listConversations,
  NotFoundError,
  recentTurns,
} from '../src/main/db/conversations.ts'

const open = () => openDatabase(':memory:')

test('append to null creates a titled conversation; messages come back in order', async () => {
  const { db, close } = open()
  const first = await appendMessage(db, 'personal', null, { role: 'user', text: 'Remind me about the Acme proposal', via: 'text' })
  await appendMessage(db, 'personal', first.conversationId, { role: 'assistant', text: 'Noted.', via: 'text' })
  const list = await listConversations(db, 'personal')
  assert.equal(list.length, 1)
  assert.equal(list[0]?.title, 'Remind me about the Acme proposal')
  assert.equal(list[0]?.messageCount, 2)
  const msgs = await getMessages(db, 'personal', first.conversationId)
  assert.deepEqual(msgs.map((m) => [m.role, m.text, m.via]), [['user', 'Remind me about the Acme proposal', 'text'], ['assistant', 'Noted.', 'text']])
  close()
})

test('workspace isolation: other workspaces cannot list, read, append to, or delete', async () => {
  const { db, close } = open()
  const m = await appendMessage(db, 'foster-automation', null, { role: 'user', text: 'Client pricing', via: 'text' })
  const id = m.conversationId
  assert.deepEqual(await listConversations(db, 'personal'), [])
  await assert.rejects(getMessages(db, 'personal', id), NotFoundError)
  await assert.rejects(appendMessage(db, 'personal', id, { role: 'user', text: 'sneaky', via: 'text' }), NotFoundError)
  await assert.rejects(recentTurns(db, 'personal', id), NotFoundError)
  assert.equal(await deleteConversation(db, 'personal', id), false)
  assert.equal((await getMessages(db, 'foster-automation', id)).length, 1, 'untouched in its own workspace')
  close()
})

test('list is newest-first and scoped; new conversation is retitled by first user message', async () => {
  const { db, close } = open()
  const a = await createConversation(db, 'research')
  await new Promise((r) => setTimeout(r, 5))
  const b = await appendMessage(db, 'research', null, { role: 'user', text: 'Second', via: 'voice' })
  await new Promise((r) => setTimeout(r, 5))
  await appendMessage(db, 'research', a, { role: 'user', text: 'Now first again', via: 'text' })
  const list = await listConversations(db, 'research')
  assert.deepEqual(list.map((c) => c.id), [a, b.conversationId])
  assert.equal(list[0]?.title, 'Now first again')
  close()
})

test('recentTurns returns the last N, oldest first', async () => {
  const { db, close } = open()
  let id: string | null = null
  for (let i = 0; i < 25; i++) {
    const m = await appendMessage(db, 'development', id, { role: i % 2 ? 'assistant' : 'user', text: `t${i}`, via: 'text' })
    id = m.conversationId
  }
  const turns = await recentTurns(db, 'development', id!, 20)
  assert.equal(turns.length, 20)
  assert.equal(turns[0]?.text, 't5')
  assert.equal(turns.at(-1)?.text, 't24')
  close()
})

test('delete removes the conversation and its messages', async () => {
  const { db, sqlite, close } = open()
  const m = await appendMessage(db, 'personal', null, { role: 'user', text: 'Temporary', via: 'text' })
  assert.equal(await deleteConversation(db, 'personal', m.conversationId), true)
  assert.deepEqual(await listConversations(db, 'personal'), [])
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n, 0)
  close()
})
