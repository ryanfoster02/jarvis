// Running tasks and their stop levels (SECURITY.md §5). Pure (no Electron); unit-tested.
//  - workflow: cancel(taskId) aborts the whole request and every action it is running;
//  - worker:   cancelAction(taskId, actionId) aborts one action (a tool call or a helper agent) —
//              the request carries on and the model is told the action was stopped;
//  - global:   cancelAll() — wired to Stop all.

import type { RunningTask, ToolName } from './ipc.ts'

interface Entry {
  info: Omit<RunningTask, 'actions'>
  controller: AbortController
  actions: Map<string, { controller: AbortController; info: RunningTask['actions'][number] }>
}

export interface ActionHandle {
  id: string
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
      info: { id, kind, title: title.length > 80 ? `${title.slice(0, 79)}…` : title, startedAt: this.now() },
      controller: new AbortController(),
      actions: new Map(),
    }
    this.tasks.set(id, entry)
    this.changed()
    return {
      id,
      signal: entry.controller.signal,
      beginAction: (tool, actionTitle) => {
        const actionId = crypto.randomUUID()
        const controller = new AbortController()
        const short = actionTitle.length > 80 ? `${actionTitle.slice(0, 79)}…` : actionTitle
        entry.actions.set(actionId, { controller, info: { id: actionId, tool, title: short, startedAt: this.now() } })
        this.changed()
        return {
          id: actionId,
          signal: AbortSignal.any([entry.controller.signal, controller.signal]),
          end: () => {
            if (entry.actions.delete(actionId) && this.tasks.has(id)) this.changed()
          },
        }
      },
      end: () => {
        if (this.tasks.delete(id)) this.changed()
      },
    }
  }

  list(): RunningTask[] {
    return [...this.tasks.values()]
      .map((e) => ({ ...e.info, actions: [...e.actions.values()].map((a) => a.info).sort((x, y) => x.startedAt - y.startedAt) }))
      .sort((a, b) => a.startedAt - b.startedAt)
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

  /** Worker level: one action. Without an action id, the only/oldest running action. */
  cancelAction(taskId: string, actionId?: string): boolean {
    const e = this.tasks.get(taskId)
    if (!e) return false
    const a = actionId ? e.actions.get(actionId) : [...e.actions.values()].sort((x, y) => x.info.startedAt - y.info.startedAt)[0]
    if (!a || a.controller.signal.aborted) return false
    a.controller.abort(new Error('Action cancelled by the owner'))
    return true
  }

  /** Global level (Stop all). */
  cancelAll(): void {
    for (const e of this.tasks.values()) e.controller.abort(new Error('Stop all'))
  }
}
