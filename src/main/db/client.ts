import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { execute } from './executor.ts'
import { configure, migrate, seedWorkspaces } from './migrations.ts'
import { schema } from './schema.ts'
import type { Db } from './conversations.ts'

// Opens (or creates) the local database. No Electron imports: tests open ':memory:' the same way.
export interface Database {
  db: Db
  sqlite: DatabaseSync
  close: () => void
}

export function openDatabase(path: string): Database {
  const sqlite = new DatabaseSync(path)
  configure(sqlite)
  migrate(sqlite)
  seedWorkspaces(sqlite)
  // node:sqlite is synchronous; the proxy callback wraps results in a resolved promise.
  const db = drizzle(async (query, params, method) => execute(sqlite, query, params, method), { schema })
  return { db, sqlite, close: () => sqlite.close() }
}
