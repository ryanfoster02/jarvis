// Saved routines (Sprint 13). Pure; unit-tested. Times are epoch ms; schedules are in local time.

import { IpcValidationError, type WorkflowInput, type WorkflowSchedule } from './ipc.ts'
import { detectSecret } from './memory.ts'
import { localIso } from './reminders.ts'
import type { ToolSpec } from './tools.ts'

export const MAX_WORKFLOW_NAME = 60
export const MAX_WORKFLOW_INSTRUCTIONS = 2000
export const MAX_WORKFLOWS = 30
export const KEEP_RUNS = 20
export const MAX_RUN_OUTPUT = 4000
export const WORKFLOW_TICK_MS = 30_000

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function validateSchedule(input: unknown): WorkflowSchedule | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'object') throw new IpcValidationError('schedule must be an object or null')
  const { days, time } = input as { days?: unknown; time?: unknown }
  if (!Array.isArray(days) || days.length === 0 || days.length > 7 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    throw new IpcValidationError('Pick at least one day for the schedule.')
  }
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new IpcValidationError('Give the time as HH:mm, e.g. 07:30.')
  return { days: [...new Set(days as number[])].sort((a, b) => a - b), time }
}

export function validateWorkflowInput(input: unknown): WorkflowInput {
  if (!input || typeof input !== 'object') throw new IpcValidationError('workflow must be an object')
  const o = input as Record<string, unknown>
  const extra = Object.keys(o).filter((k) => !['id', 'name', 'instructions', 'schedule', 'enabled'].includes(k))
  if (extra.length) throw new IpcValidationError(`Unexpected field: ${extra[0]}`)
  if (o.id !== undefined && (typeof o.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(o.id))) throw new IpcValidationError('invalid workflow id')
  const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw new IpcValidationError('Give the routine a name.')
  if (name.length > MAX_WORKFLOW_NAME) throw new IpcValidationError(`Keep the name under ${MAX_WORKFLOW_NAME} characters.`)
  const instructions = typeof o.instructions === 'string' ? o.instructions.trim() : ''
  if (instructions.length < 10) throw new IpcValidationError('Describe what Jarvis should do (at least a sentence).')
  if (instructions.length > MAX_WORKFLOW_INSTRUCTIONS) throw new IpcValidationError(`Keep the instructions under ${MAX_WORKFLOW_INSTRUCTIONS} characters.`)
  const secret = detectSecret(`${name} ${instructions}`)
  if (secret) throw new IpcValidationError(`That looks like it contains ${secret}. Routines can't hold credentials.`)
  if (typeof o.enabled !== 'boolean') throw new IpcValidationError('enabled must be true or false')
  return { ...(typeof o.id === 'string' ? { id: o.id.toLowerCase() } : {}), name, instructions, schedule: validateSchedule(o.schedule), enabled: o.enabled }
}

/** Next scheduled time strictly after `after`, in local time; null when unscheduled. */
export function nextRun(schedule: WorkflowSchedule | null, after: number): number | null {
  if (!schedule) return null
  const [h, m] = schedule.time.split(':').map(Number) as [number, number]
  for (let i = 0; i <= 7; i++) {
    const d = new Date(after)
    d.setDate(d.getDate() + i)
    d.setHours(h, m, 0, 0)
    if (schedule.days.includes(d.getDay()) && d.getTime() > after) return d.getTime()
  }
  return null
}

/** "Weekdays at 7:30 AM", "Every day at 18:00"-style wording, in the given locale. */
export function describeSchedule(schedule: WorkflowSchedule | null, locale?: string): string {
  if (!schedule) return 'Run manually'
  const [h, m] = schedule.time.split(':').map(Number) as [number, number]
  const d = new Date(2026, 0, 4, h, m) // any date: only the time is shown
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const key = schedule.days.join(',')
  const days =
    key === '0,1,2,3,4,5,6' ? 'Every day' : key === '1,2,3,4,5' ? 'Weekdays' : key === '0,6' ? 'Weekends' : schedule.days.map((x) => DAY_NAMES[x]).join(', ')
  return `${days} at ${time}`
}

/** The message Jarvis receives for a run. */
export function workflowMessage(o: { name: string; instructions: string; now: number; trigger: 'manual' | 'schedule' }): string {
  return [
    `Run my saved routine "${o.name}". It is now ${localIso(o.now)}.`,
    o.trigger === 'schedule'
      ? 'This run was started by the schedule while I may be away: you have read-only tools only, so report anything that needs an action instead of doing it.'
      : 'I started this run myself.',
    'Give me the result as a short report I can read in under a minute.',
    '',
    'Routine instructions:',
    o.instructions,
  ].join('\n')
}

/** Scheduled runs are unattended: read-only (low-risk) tools only. Manual runs get everything offered. */
export const workflowTools = (offered: ToolSpec[], trigger: 'manual' | 'schedule'): ToolSpec[] =>
  trigger === 'schedule' ? offered.filter((t) => t.risk === 'low') : offered

export const clipOutput = (s: string): string => (s.length > MAX_RUN_OUTPUT ? `${s.slice(0, MAX_RUN_OUTPUT - 1)}…` : s)

/** Starter routines the owner can adapt. */
export const WORKFLOW_TEMPLATES: ReadonlyArray<Omit<WorkflowInput, 'id' | 'enabled'>> = [
  {
    name: 'Morning briefing',
    instructions:
      "Tell me today's date. List my reminders for today. If GitHub repositories are allowed, use helpers to check each one for open issues and pull requests updated since yesterday, then summarise anything that needs my attention. Finish with the one thing I should do first.",
    schedule: { days: [1, 2, 3, 4, 5], time: '07:30' },
  },
  {
    name: 'Repository check',
    instructions:
      'For each allowed GitHub repository, list open pull requests and the newest issues, and note anything stale (no update for two weeks). Keep it to a few lines per repository.',
    schedule: null,
  },
  {
    name: 'End-of-day wrap-up',
    instructions: "List tomorrow's reminders and anything due in the next three days. Suggest one reminder I might want to add.",
    schedule: { days: [1, 2, 3, 4, 5], time: '17:30' },
  },
]
