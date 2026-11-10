import { BrowserWindow } from 'electron'
import { Events, type ApprovalRequest, type RiskLevel, type ToolName, type ToolSource } from '../shared/ipc.ts'
import { isHalted, onHalt } from './killswitch.ts'

// Approvals queue (SECURITY.md §3–5). Held in main-process memory only: a pending request exists
// while the tool call that raised it is waiting. The owner answers from the UI; no answer within
// APPROVAL_TIMEOUT_MS counts as "no". Stop all answers every pending request with "no".

export const APPROVAL_TIMEOUT_MS = 120_000
export type ApprovalAnswer = 'approved' | 'denied' | 'expired' | 'halted'

interface Pending {
  request: ApprovalRequest
  resolve: (a: ApprovalAnswer) => void
}

const pending = new Map<string, Pending>()

export const listApprovals = (): ApprovalRequest[] => [...pending.values()].map((p) => ({ ...p.request }))

function broadcast(): void {
  const list = listApprovals()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Events.approvalsChanged, list)
  }
}

/** Ask the owner. Resolves when they answer, time runs out, or Stop all is pressed. */
export function requestApproval(o: { tool: ToolName; title: string; risk: RiskLevel; summary: string; source: ToolSource }): Promise<ApprovalAnswer> {
  if (isHalted()) return Promise.resolve('halted')
  const now = Date.now()
  const request: ApprovalRequest = { id: crypto.randomUUID(), ...o, requestedAt: now, expiresAt: now + APPROVAL_TIMEOUT_MS }
  return new Promise<ApprovalAnswer>((resolve) => {
    let settled = false
    const finish = (answer: ApprovalAnswer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      offHalt()
      pending.delete(request.id)
      broadcast()
      resolve(answer)
    }
    const timer = setTimeout(() => finish('expired'), APPROVAL_TIMEOUT_MS)
    const offHalt = onHalt(() => finish('halted'))
    pending.set(request.id, { request, resolve: finish })
    broadcast()
  })
}

/** The owner's answer from the UI. Returns false if the request no longer exists. */
export function answerApproval(id: string, approve: boolean): boolean {
  const p = pending.get(id)
  if (!p) return false
  p.resolve(approve ? 'approved' : 'denied')
  return true
}
