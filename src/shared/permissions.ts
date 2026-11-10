// Permission engine and execution limits (SECURITY.md §3, §4, §6). Pure; unit-tested.
//
// Precedence: kill switch > high-risk approval > scope > permission > mandate.
// A mandate (standing permission) can only waive the question for medium-risk actions in its scope.
// Nothing here can be changed by a tool: tools never edit settings, permissions or mandates.

import type { ExecutionLimits, ToolDecision } from './ipc.ts'
import type { ToolScope, ToolSpec } from './tools.ts'

export interface PermissionContext {
  halted: boolean
  /** Tools the owner switched off (permissions). */
  disabled: readonly string[]
  /** Scopes the active workspace may touch. */
  grantedScopes: readonly ToolScope[]
  /** Scopes covered by a standing permission (mandates). */
  mandates: readonly ToolScope[]
  /**
   * The task has already read untrusted content (e.g. GitHub). Anything it proposes next may have been
   * steered by that content, so standing permissions stop applying: medium risk asks (SECURITY.md §7).
   */
  untrusted?: boolean
}

export type PermissionResult =
  | { kind: 'allow'; decision: Extract<ToolDecision, 'auto' | 'mandate'> }
  | { kind: 'ask'; reason: string }
  | { kind: 'deny'; reason: string }

export function decide(tool: ToolSpec, ctx: PermissionContext): PermissionResult {
  // Restrictions that refuse outright come first, so nothing below can loosen them.
  if (ctx.halted) return { kind: 'deny', reason: 'Stop all is engaged. No actions run until the owner re-arms.' }
  if (!ctx.grantedScopes.includes(tool.scope)) return { kind: 'deny', reason: `No access to ${tool.scope}: it isn't connected or set up for this.` }
  if (ctx.disabled.includes(tool.name)) return { kind: 'deny', reason: 'The owner has switched this tool off.' }
  // High risk: always asks. Mandates are never consulted.
  if (tool.risk === 'high') return { kind: 'ask', reason: 'High-risk actions always need the owner’s approval.' }
  if (tool.risk === 'low') return { kind: 'allow', decision: 'auto' }
  if (ctx.untrusted) return { kind: 'ask', reason: 'This task read untrusted content, so standing permissions don’t apply.' }
  if (ctx.mandates.includes(tool.scope)) return { kind: 'allow', decision: 'mandate' }
  return { kind: 'ask', reason: 'Medium-risk actions need approval unless the owner gave standing permission.' }
}

/** Whether a tool is offered to the model at all. */
export function isOffered(tool: ToolSpec, ctx: Pick<PermissionContext, 'disabled' | 'grantedScopes'>): boolean {
  return !ctx.disabled.includes(tool.name) && ctx.grantedScopes.includes(tool.scope)
}

/**
 * Budget for one task (one typed message and every model/tool step it triggers).
 * Time spent waiting for the owner's approval is not counted against the time limit.
 */
export class RunBudget {
  private readonly started: number
  private paused = 0
  private iterations = 0
  private toolCalls = 0
  private cost = 0
  private readonly limits: ExecutionLimits
  private readonly now: () => number

  constructor(limits: ExecutionLimits, now: () => number = Date.now) {
    this.limits = limits
    this.now = now
    this.started = now()
  }

  /** Call before each model request. Returns a reason to stop, or null. */
  nextIteration(): string | null {
    if (this.iterations >= this.limits.maxIterations) return `stopped after ${this.limits.maxIterations} steps (the per-task limit)`
    this.iterations++
    return this.overTimeOrCost()
  }

  /** Call before each tool call. */
  nextToolCall(): string | null {
    if (this.toolCalls >= this.limits.maxToolCalls) return `stopped after ${this.limits.maxToolCalls} actions (the per-task limit)`
    this.toolCalls++
    return this.overTimeOrCost()
  }

  addCost(usd: number | null): void {
    if (usd !== null && Number.isFinite(usd) && usd > 0) this.cost += usd
  }

  excludeWait(ms: number): void {
    if (ms > 0) this.paused += ms
  }

  overTimeOrCost(): string | null {
    if (this.elapsedMs() > this.limits.maxSeconds * 1000) return `stopped after ${this.limits.maxSeconds} seconds (the per-task limit)`
    if (this.cost > this.limits.maxCostUsd) return `stopped at about $${this.cost.toFixed(2)} (the per-task spend limit is $${this.limits.maxCostUsd.toFixed(2)})`
    return null
  }

  elapsedMs(): number {
    return this.now() - this.started - this.paused
  }

  get stats(): { iterations: number; toolCalls: number; costUsd: number } {
    return { iterations: this.iterations, toolCalls: this.toolCalls, costUsd: this.cost }
  }
}
