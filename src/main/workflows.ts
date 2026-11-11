import { BrowserWindow } from 'electron'
import { runAgent } from '../shared/agent.ts'
import { isParallelSafe } from '../shared/helpers.ts'
import {
  DEFAULT_LIMITS,
  Events,
  isToolName,
  TEXT_PROVIDER_NAMES,
  textModelProvider,
  WORKSPACES,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunNotice,
} from '../shared/ipc.ts'
import { isOffered, RunBudget } from '../shared/permissions.ts'
import { buildProviderRequest, estimateTextCostUsd } from '../shared/text.ts'
import { specsForRequest, TOOLS } from '../shared/tools.ts'
import { WORKFLOW_TICK_MS, workflowMessage, workflowTools } from '../shared/workflows.ts'
import type { Db } from './db/conversations.ts'
import { memoriesForPrompt } from './db/memories.ts'
import { closeStaleRuns, dueWorkflows, finishRun, rescheduleAll, rescheduleFrom, startRun } from './db/workflows.ts'
import { isHalted } from './killswitch.ts'
import { notify } from './scheduler.ts'
import { loadSettings } from './settings.ts'
import { tasks } from './tasks.ts'
import { webhookNames } from './webhooks.ts'
import { TEXT_PROVIDER_IMPLS } from './textProviders.ts'
import { executeTracked, permissionContext } from './tools.ts'
import { getKey } from './vault.ts'

// Saved routines (Sprint 13). A run is a typed request whose message is the routine: same agent loop,
// tools, helpers, approvals, limits, stop levels and kill switch. Scheduled runs are unattended, so
// they are read-only (offered low-risk tools only, and the executor refuses anything else).
// Scheduling happens only while JARVIS runs; times missed while it was closed are skipped, not caught up.

const runningWorkflows = new Set<string>()
let timer: ReturnType<typeof setInterval> | null = null

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export const workflowsChanged = (): void => broadcast(Events.workflowsChanged)

export class WorkflowBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowBusyError'
  }
}

/**
 * Checks, records the run, then works in the background. Throws WorkflowBusyError (nothing recorded)
 * when the run can't start right now. Returns the run and a promise for its end.
 */
export async function startWorkflow(db: Db, wf: Workflow, trigger: WorkflowRun['trigger']): Promise<{ run: WorkflowRun; done: Promise<WorkflowRun> }> {
  if (isHalted()) throw new WorkflowBusyError('Stop all is engaged. Re-arm Jarvis to run routines.')
  if (runningWorkflows.has(wf.id)) throw new WorkflowBusyError(`"${wf.name}" is already running.`)
  const busy = tasks.count('typed') + tasks.count('workflow')
  if (busy >= DEFAULT_LIMITS.maxConcurrentAgents) {
    throw new WorkflowBusyError(`Jarvis is already working on ${busy} requests. Try again when one finishes.`)
  }
  runningWorkflows.add(wf.id)
  const run = await startRun(db, wf.id, trigger)
  workflowsChanged()
  return { run, done: execute(db, wf, run).finally(() => runningWorkflows.delete(wf.id)) }
}

async function execute(db: Db, wf: Workflow, run: WorkflowRun): Promise<WorkflowRun> {
  const settings = loadSettings()
  const workspaceName = WORKSPACES.find((w) => w.id === wf.workspaceId)?.name ?? 'Personal'
  const providerId = textModelProvider(settings.textModel)
  const key = getKey(providerId)
  let result: { status: Exclude<WorkflowRun['status'], 'running'>; output: string; actions: number }

  if (!key) {
    result = { status: 'error', output: `No ${TEXT_PROVIDER_NAMES[providerId]} key is saved, so routines can't run. Add it in Settings → AI provider.`, actions: 0 }
  } else {
    const provider = TEXT_PROVIDER_IMPLS[providerId]
    const toolCtx = { db, ws: wf.workspaceId, workspaceName, source: 'text' as const, settings, readOnly: run.trigger === 'schedule' }
    const perm = permissionContext(toolCtx)
    const tools = specsForRequest(
      workflowTools(
        Object.values(TOOLS).filter((t) => isOffered(t, perm)),
        run.trigger,
      ),
      settings.githubRepos,
      webhookNames(),
    )
    const body = buildProviderRequest({
      model: settings.textModel,
      workspaceName,
      persona: settings.persona,
      honorific: settings.honorific,
      history: [],
      message: workflowMessage({ name: wf.name, instructions: wf.instructions, now: Date.now(), trigger: run.trigger }),
      memories: await memoriesForPrompt(db, wf.workspaceId),
      tools,
    })
    const task = tasks.start('workflow', `Routine: ${wf.name}`)
    try {
      const r = await runAgent({
        provider: providerId,
        body,
        send: (b, signal) => provider.send(key, b, signal),
        parse: provider.parse,
        cost: (u) => estimateTextCostUsd(settings.textModel, u),
        execute: (call, state) => executeTracked(task, call, { ...toolCtx, untrusted: state.untrusted }),
        budget: new RunBudget(DEFAULT_LIMITS),
        halted: isHalted,
        signal: task.signal,
        parallelSafe: (n) => isParallelSafe(isToolName(n) ? TOOLS[n] : undefined),
      })
      result = r.ok
        ? {
            status: r.text ? 'ok' : 'error',
            output: `${r.text || 'Jarvis returned no report.'}${r.stopped ? `\n(Jarvis ${r.stopped}.)` : ''}`,
            actions: r.actions.length,
          }
        : { status: r.code === 'cancelled' || r.code === 'halted' ? 'cancelled' : 'error', output: r.message, actions: r.actions.length }
    } catch (err) {
      console.error('[workflows] run failed:', err)
      result = { status: 'error', output: 'The routine failed unexpectedly. Try running it again.', actions: 0 }
    } finally {
      task.end()
    }
  }

  const done = await finishRun(db, run, result)
  const notice: WorkflowRunNotice = { run: done, workflowName: wf.name, workspaceId: wf.workspaceId }
  broadcast(Events.workflowFinished, notice)
  workflowsChanged()
  if (done.status !== 'cancelled') {
    notify(done.status === 'ok' ? `Routine ready · ${wf.name}` : `Routine failed · ${wf.name}`, done.output.slice(0, 140))
  }
  return done
}

async function tick(db: Db): Promise<void> {
  if (isHalted()) return // nothing starts while stopped; the next time comes round as usual
  const now = Date.now()
  const due = await dueWorkflows(db, now)
  if (due.length === 0) return
  for (const wf of due) {
    // Move the schedule on first, so a slow or failed run is never repeated in a loop.
    await rescheduleFrom(db, wf.id, wf.schedule, now)
    try {
      await startWorkflow(db, wf, 'schedule')
    } catch (err) {
      // Busy at the scheduled time: record that it was skipped, honestly.
      if (err instanceof WorkflowBusyError) {
        const run = await startRun(db, wf.id, 'schedule', now)
        await finishRun(db, run, { status: 'cancelled', output: `Skipped at its scheduled time: ${err.message}`, actions: 0 })
      } else {
        console.error('[workflows] scheduled run failed to start:', err)
      }
    }
  }
  workflowsChanged()
}

export async function startWorkflowScheduler(db: Db): Promise<void> {
  try {
    const now = Date.now()
    await closeStaleRuns(db, now)
    await rescheduleAll(db, now)
  } catch (err) {
    console.error('[workflows] startup failed:', err)
  }
  timer ??= setInterval(() => {
    tick(db).catch((err: unknown) => console.error('[workflows] tick failed:', err))
  }, WORKFLOW_TICK_MS)
}

export function stopWorkflowScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
