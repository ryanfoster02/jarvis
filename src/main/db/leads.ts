import { and, asc, eq, sql } from 'drizzle-orm'
import type { Lead, LeadInput, WorkspaceId } from '../../shared/ipc.ts'
import { MAX_LEADS } from '../../shared/leads.ts'
import type { Db } from './conversations.ts'
import { leads } from './schema.ts'

// Leads pipeline, scoped to a workspace (another workspace's leads behave as not found).

export class LeadNotFoundError extends Error {
  constructor() {
    super('Lead not found in this workspace.')
    this.name = 'LeadNotFoundError'
  }
}
export class LeadLimitError extends Error {
  constructor() {
    super(`You have ${MAX_LEADS} leads here. Delete some before adding more.`)
    this.name = 'LeadLimitError'
  }
}

export async function listLeads(db: Db, ws: WorkspaceId): Promise<Lead[]> {
  return db
    .select()
    .from(leads)
    .where(eq(leads.workspaceId, ws))
    .orderBy(asc(sql`CASE ${leads.status} WHEN 'won' THEN 1 WHEN 'lost' THEN 2 ELSE 0 END`), asc(sql`${leads.nextDate} IS NULL`), asc(leads.nextDate), asc(leads.name))
}

export async function getLead(db: Db, ws: WorkspaceId, id: string): Promise<Lead> {
  const rows = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.workspaceId, ws))).limit(1)
  const r = rows[0]
  if (!r) throw new LeadNotFoundError()
  return r
}

/** Create (no id) or replace (id) a lead. Input must already be validated (validateLeadInput). */
export async function saveLead(db: Db, ws: WorkspaceId, input: LeadInput, now = Date.now()): Promise<Lead> {
  const { id, ...fields } = input
  if (id) {
    await getLead(db, ws, id)
    await db.update(leads).set({ ...fields, updatedAt: now }).where(eq(leads.id, id))
    return getLead(db, ws, id)
  }
  const count = (await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, ws))).length
  if (count >= MAX_LEADS) throw new LeadLimitError()
  const row: Lead = { id: crypto.randomUUID(), workspaceId: ws, ...fields, createdAt: now, updatedAt: now }
  await db.insert(leads).values(row)
  return row
}

export async function deleteLead(db: Db, ws: WorkspaceId, id: string): Promise<void> {
  await getLead(db, ws, id)
  await db.delete(leads).where(eq(leads.id, id))
}
