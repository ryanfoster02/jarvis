import { and, asc, desc, eq, inArray, lte, or } from 'drizzle-orm'
import type { Reminder, WorkspaceId } from '../../shared/ipc.ts'
import { MAX_PENDING_REMINDERS } from '../../shared/reminders.ts'
import type { Db } from './conversations.ts'
import { reminders } from './schema.ts'

// Reminder store. Owner-facing functions are scoped to a workspace (another workspace's reminders
// behave as not found). The scheduler alone reads across workspaces, to fire whatever is due.

export class ReminderNotFoundError extends Error {
  constructor() {
    super('Reminder not found in this workspace.')
    this.name = 'ReminderNotFoundError'
  }
}

export class ReminderLimitError extends Error {
  constructor() {
    super(`You have ${MAX_PENDING_REMINDERS} upcoming reminders here. Cancel some before adding more.`)
    this.name = 'ReminderLimitError'
  }
}

export async function addReminder(
  db: Db,
  ws: WorkspaceId,
  input: { text: string; dueAt: number; source: Reminder['source'] },
): Promise<Reminder> {
  const pending = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(and(eq(reminders.workspaceId, ws), eq(reminders.status, 'pending')))
  if (pending.length >= MAX_PENDING_REMINDERS) throw new ReminderLimitError()
  const row: Reminder = {
    id: crypto.randomUUID(),
    workspaceId: ws,
    text: input.text,
    dueAt: input.dueAt,
    status: 'pending',
    source: input.source,
    createdAt: Date.now(),
    firedAt: null,
  }
  await db.insert(reminders).values(row)
  return row
}

/** For the owner: upcoming plus fired/missed ones not yet dismissed, soonest/most recent first. */
export async function listReminders(db: Db, ws: WorkspaceId): Promise<Reminder[]> {
  const attention = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.workspaceId, ws), or(eq(reminders.status, 'fired'), eq(reminders.status, 'missed'))))
    .orderBy(desc(reminders.dueAt))
    .limit(50)
  const upcoming = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.workspaceId, ws), eq(reminders.status, 'pending')))
    .orderBy(asc(reminders.dueAt))
    .limit(MAX_PENDING_REMINDERS)
  return [...attention, ...upcoming]
}

async function owned(db: Db, ws: WorkspaceId, id: string): Promise<Reminder> {
  const rows = await db.select().from(reminders).where(and(eq(reminders.id, id), eq(reminders.workspaceId, ws))).limit(1)
  const r = rows[0]
  if (!r) throw new ReminderNotFoundError()
  return r
}

export async function getReminder(db: Db, ws: WorkspaceId, id: string): Promise<Reminder> {
  return owned(db, ws, id)
}

/** Cancel an upcoming reminder. Only pending ones can be cancelled. */
export async function cancelReminder(db: Db, ws: WorkspaceId, id: string): Promise<Reminder> {
  const r = await owned(db, ws, id)
  if (r.status !== 'pending') throw new ReminderNotFoundError()
  await db.update(reminders).set({ status: 'cancelled' }).where(eq(reminders.id, id))
  return { ...r, status: 'cancelled' }
}

/** Acknowledge a fired or missed reminder. */
export async function dismissReminder(db: Db, ws: WorkspaceId, id: string): Promise<Reminder> {
  const r = await owned(db, ws, id)
  if (r.status !== 'fired' && r.status !== 'missed') throw new ReminderNotFoundError()
  await db.update(reminders).set({ status: 'dismissed' }).where(eq(reminders.id, id))
  return { ...r, status: 'dismissed' }
}

/** Fired or missed → pending again at a new time. */
export async function snoozeReminder(db: Db, ws: WorkspaceId, id: string, until: number): Promise<Reminder> {
  const r = await owned(db, ws, id)
  if (r.status !== 'fired' && r.status !== 'missed') throw new ReminderNotFoundError()
  await db.update(reminders).set({ status: 'pending', dueAt: until, firedAt: null }).where(eq(reminders.id, id))
  return { ...r, status: 'pending', dueAt: until, firedAt: null }
}

// ---------- Scheduler (all workspaces) ----------

export async function pendingDue(db: Db, now: number): Promise<Reminder[]> {
  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.status, 'pending'), lte(reminders.dueAt, now)))
    .orderBy(asc(reminders.dueAt))
}

export async function markFired(db: Db, ids: string[], at: number): Promise<void> {
  if (ids.length) await db.update(reminders).set({ status: 'fired', firedAt: at }).where(and(inArray(reminders.id, ids), eq(reminders.status, 'pending')))
}

export async function markMissed(db: Db, ids: string[]): Promise<void> {
  if (ids.length) await db.update(reminders).set({ status: 'missed' }).where(and(inArray(reminders.id, ids), eq(reminders.status, 'pending')))
}

/** Soonest upcoming reminder in any workspace (for the menu-bar icon). */
export async function nextPending(db: Db): Promise<Reminder | null> {
  const rows = await db.select().from(reminders).where(eq(reminders.status, 'pending')).orderBy(asc(reminders.dueAt)).limit(1)
  return rows[0] ?? null
}
