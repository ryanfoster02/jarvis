import { app } from 'electron'
import { statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { summarizeProcesses, startupRows, type PerfSnapshot, type StartupMark, type StartupMarks } from '../shared/perf.ts'

// Startup timeline and resource readings (Sprint 16). performance.now() in the main process
// counts from process start, so every mark is "ms since JARVIS started".

const marks: StartupMarks = {}
let databasePath: string | null = null
let lastMetricsAt = performance.now()

/** Records a milestone once; later calls (e.g. a second window) are ignored. */
export function markStartup(mark: StartupMark): void {
  if (marks[mark] === undefined) marks[mark] = performance.now()
}

export function setDatabasePath(path: string | null): void {
  databasePath = path
}

/** Electron reports CPU as usage since the previous call: take a first reading so the next one covers a real interval. */
export function primeMetrics(): void {
  app.getAppMetrics()
  lastMetricsAt = performance.now()
}

function fileMB(path: string): number {
  try {
    return statSync(path).size / (1024 * 1024)
  } catch {
    return 0
  }
}

export function perfSnapshot(): PerfSnapshot {
  const now = performance.now()
  const metrics = app.getAppMetrics().map((m) => ({
    type: m.type,
    cpu: { percentCPUUsage: m.cpu.percentCPUUsage },
    memory: { workingSetSize: m.memory.workingSetSize },
  }))
  const cpuWindowSec = Math.max(0, Math.round((now - lastMetricsAt) / 100) / 10)
  lastMetricsAt = now
  const summary = summarizeProcesses(metrics)
  const databaseMB = databasePath
    ? Math.round((fileMB(databasePath) + fileMB(`${databasePath}-wal`)) * 10) / 10
    : null
  return {
    startup: startupRows(marks),
    ...summary,
    cpuWindowSec,
    databaseMB,
    uptimeSec: Math.round(now / 1000),
    takenAt: new Date().toISOString(),
  }
}
