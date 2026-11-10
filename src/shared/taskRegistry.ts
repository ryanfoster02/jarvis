// Running tasks and their stop levels (SECURITY.md §5). Pure (no Electron); unit-tested.
//  - workflow: cancel(taskId) aborts the whole request and whatever action it is running;
//  - worker:   cancelAction(taskId) aborts only the current action — the request carries on and
//              the model is told the action was stopped;
//  - global:   cancelAll() — wired to Stop all.

import type { RunningTask, ToolName } from './ipc.ts'

interface Entry {
  info: RunningTask
  controller: AbortController
  action: AbortController | null
}

export interface ActionHandle {
  /** Aborts if the action or its task is cancelled. */
  signal: AbortSignal
  end: () => void
}

export interface TaskHandle {
  id: string
  signal: AbortSignal
  beginAction: (tool: ToolName, title: string) => ActionHandle
  end: () => void
}

export class TaskRegistry {
  private readonly tasks = new Map<string, Entry>()
  private readonly onChange: (list: RunningTask[]) => void
  private readonly now: () => number

  constructor(onChange: (list: RunningTask[]) => void = () => {}, now: () => number = Date.now) {
    this.onChange = onChange
    this.now = now
  }

  private changed(): void {
    this.onChange(this.list())
  }

  start(kind: RunningTask['kind'], title: string): TaskHandle {
    const id = crypto.randomUUID()
    const entry: Entry = {
      info: { id, kind, title: title.length > 80 ? `${title.slice(0, 79)}…` : title, startedAt: this.now(), action: null },
      controller: new AbortController(),
      action: null,
    }
    this.tasks.set(id, entry)
    this.changed()
    return {
      id,
      signal: entry.controller.signal,
      beginAction: (tool, actionTitle) => {
        const ac = new AbortController()
        entry.action = ac
        entry.info = { ...entry.info, action: { tool, title: actionTitle, startedAt: this.now() } }
        this.changed()
        return {
          signal: AbortSignal.any([entry.controller.signal, ac.signal]),
          end: () => {
            if (entry.action !== ac) return
            entry.action = null
            entry.info = { ...entry.info, action: null }
            if (this.tasks.has(id)) this.changed()
          },
        }
      },
      end: () => {
        if (this.tasks.delete(id)) this.changed()
      },
    }
  }

  list(): RunningTask[] {
    return [...this.tasks.values()].map((e) => e.info).sort((a, b) => a.startedAt - b.startedAt)
  }

  count(kind: RunningTask['kind']): number {
    return [...this.tasks.values()].filter((e) => e.info.kind === kind).length
  }

  /** Workflow level. */
  cancel(id: string): boolean {
    const e = this.tasks.get(id)
    if (!e || e.controller.signal.aborted) return false
    e.controller.abort(new Error('Cancelled by the owner'))
    return true
  }

  /** Worker level: only the action running now. */
  cancelAction(id: string): boolean {
    const e = this.tasks.get(id)
    if (!e?.action || e.action.signal.aborted) return false
    e.action.abort(new Error('Action cancelled by the owner'))
    return true
  }

  /** Global level (Stop all). */
  cancelAll(): void {
    for (const e of this.tasks.values()) e.controller.abort(new Error('Stop all'))
  }
}
