import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

// Bridges Drizzle's sqlite-proxy driver to Node's built-in node:sqlite (no native module to rebuild).
// Contract (orm.drizzle.team, sqlite-proxy): callback(sql, params, method) → { rows }, where rows are
// arrays in column order; 'all' / 'values' → row[][], 'get' → a single row array, 'run' → [].
// No Electron imports: unit-tested under plain Node.

export type ProxyMethod = 'run' | 'all' | 'values' | 'get'

type ArrayStatement = { setReturnArrays?: (enabled: boolean) => void }

function toSqlValue(v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v
  if (v instanceof Uint8Array) return v
  if (v instanceof Date) return v.getTime()
  return JSON.stringify(v)
}

export function execute(db: DatabaseSync, sql: string, params: unknown[], method: ProxyMethod): { rows: unknown[] } {
  const stmt = db.prepare(sql)
  const args = params.map(toSqlValue)
  if (method === 'run') {
    stmt.run(...args)
    return { rows: [] }
  }
  // Prefer native array rows; fall back to object values (SELECT column order is preserved).
  const arrayStmt = stmt as unknown as ArrayStatement
  const native = typeof arrayStmt.setReturnArrays === 'function'
  if (native) arrayStmt.setReturnArrays?.(true)
  const asArray = (row: unknown): unknown[] =>
    native ? (row as unknown[]) : Object.values(row as Record<string, unknown>)
  if (method === 'get') {
    const row = stmt.get(...args)
    return { rows: row === undefined ? (undefined as unknown as unknown[]) : asArray(row) }
  }
  return { rows: stmt.all(...args).map(asArray) }
}
