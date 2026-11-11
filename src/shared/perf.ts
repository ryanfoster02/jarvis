// Performance measurements (Sprint 16). Pure: no Electron/Node imports.
// Main records startup marks and reads process metrics; this module shapes them for the UI.

/** Startup milestones, in order. Times are ms since the main process started. */
export const STARTUP_MARKS = ['appReady', 'databaseReady', 'windowShown', 'dashboardReady'] as const
export type StartupMark = (typeof STARTUP_MARKS)[number]

export const STARTUP_LABEL: Record<StartupMark, string> = {
  appReady: 'App ready',
  databaseReady: 'Database open',
  windowShown: 'Window shown',
  dashboardReady: 'Dashboard ready',
}

export type StartupMarks = Partial<Record<StartupMark, number>>

export interface StartupRow {
  mark: StartupMark
  label: string
  /** ms since the process started. */
  atMs: number
  /** ms since the previous recorded mark (or process start). */
  stepMs: number
}

/** Recorded marks in milestone order, each with the time it took since the previous one. */
export function startupRows(marks: StartupMarks): StartupRow[] {
  const rows: StartupRow[] = []
  let prev = 0
  for (const mark of STARTUP_MARKS) {
    const at = marks[mark]
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) continue
    rows.push({ mark, label: STARTUP_LABEL[mark], atMs: Math.round(at), stepMs: Math.max(0, Math.round(at - prev)) })
    prev = at
  }
  return rows
}

/** The subset of Electron's ProcessMetric we use (memory sizes are in KB). */
export interface RawProcessMetric {
  type: string
  cpu: { percentCPUUsage: number }
  memory: { workingSetSize: number }
}

export const PROCESS_LABEL: Record<string, string> = {
  Browser: 'Main process',
  Tab: 'Interface',
  GPU: 'Graphics',
  Utility: 'Helpers',
}

export interface ProcessUsage {
  label: string
  count: number
  memoryMB: number
  /** Share of one CPU core since the previous reading, in %. */
  cpuPercent: number
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Groups Electron's per-process metrics by kind, in a stable order; totals memory and CPU. */
export function summarizeProcesses(metrics: readonly RawProcessMetric[]): {
  processes: ProcessUsage[]
  totalMemoryMB: number
  totalCpuPercent: number
} {
  const groups = new Map<string, ProcessUsage>()
  for (const m of metrics) {
    const label = PROCESS_LABEL[m.type] ?? 'Other'
    const g = groups.get(label) ?? { label, count: 0, memoryMB: 0, cpuPercent: 0 }
    g.count += 1
    g.memoryMB += Math.max(0, m.memory.workingSetSize) / 1024
    g.cpuPercent += Math.max(0, m.cpu.percentCPUUsage)
    groups.set(label, g)
  }
  const order = [...Object.values(PROCESS_LABEL), 'Other']
  const processes = [...groups.values()]
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
    .map((g) => ({ ...g, memoryMB: round1(g.memoryMB), cpuPercent: round1(g.cpuPercent) }))
  return {
    processes,
    totalMemoryMB: round1(processes.reduce((n, p) => n + p.memoryMB, 0)),
    totalCpuPercent: round1(processes.reduce((n, p) => n + p.cpuPercent, 0)),
  }
}

export interface PerfSnapshot {
  startup: StartupRow[]
  processes: ProcessUsage[]
  totalMemoryMB: number
  totalCpuPercent: number
  /** Seconds the CPU figures cover (since the previous reading). */
  cpuWindowSec: number
  /** Database file size incl. its write-ahead log, or null without a database. */
  databaseMB: number | null
  uptimeSec: number
  takenAt: string
}

/**
 * Idle animation is paused when nobody is looking: the window is hidden or minimised, or it is
 * in the background while Jarvis is just standing by. States that carry information (listening,
 * thinking, working, speaking, needs you) keep moving.
 */
export function shouldCalm(o: { hidden: boolean; focused: boolean; state: string }): boolean {
  if (o.hidden) return true
  return !o.focused && o.state === 'idle'
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

export function formatMB(mb: number): string {
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}
