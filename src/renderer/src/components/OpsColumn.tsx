import { useEffect, useState } from 'react'
import { DEFAULT_LIMITS, type ApprovalRequest, type ToolRun } from '../../../shared/ipc.ts'
import { DECISION_LABEL } from '../../../shared/tools.ts'
import { LIMITS } from '../../../shared/ratelimit.ts'

// Planned integrations, in rollout order. None are connected in Sprint 2;
// status reflects reality, and there are no buttons that do nothing.
const INTEGRATIONS = [
  { name: 'GitHub', note: 'First integration, read-only to start' },
  { name: 'Google Calendar', note: 'Planned' },
  { name: 'Gmail', note: 'Planned — drafts only until approved' },
  { name: 'Google Drive', note: 'Planned' },
  { name: 'n8n', note: 'Planned' },
] as const

const LIMIT_ROWS: Array<[string, string]> = [
  ['Steps per task', String(DEFAULT_LIMITS.maxIterations)],
  ['Time per task', `${DEFAULT_LIMITS.maxSeconds} s`],
  ['Tool calls per task', String(DEFAULT_LIMITS.maxToolCalls)],
  ['Spend per task', `$${DEFAULT_LIMITS.maxCostUsd.toFixed(2)}`],
  ['Tasks at once', `${DEFAULT_LIMITS.maxConcurrentAgents}, no nesting`],
]

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const

const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

interface Props {
  approvals: ApprovalRequest[]
  runs: ToolRun[]
  halted: boolean
  onDecide: (id: string, approve: boolean) => void
}

function ApprovalCard({ a, now, onDecide }: { a: ApprovalRequest; now: number; onDecide: Props['onDecide'] }): React.JSX.Element {
  const secs = Math.max(0, Math.ceil((a.expiresAt - now) / 1000))
  return (
    <li className={`approval approval-${a.risk}`} aria-label={`${a.title}, ${RISK_LABEL[a.risk]}`}>
      <div className="approval-head">
        <span className={`risk-badge risk-${a.risk}`}>{RISK_LABEL[a.risk]}</span>
        <span className="approval-title">{a.title}</span>
        <span className="approval-meta">
          {a.source === 'voice' ? 'voice · ' : ''}
          {secs}s
        </span>
      </div>
      <p className="approval-summary">{a.summary}</p>
      <div className="approval-actions">
        <button className="btn btn-approve" onClick={() => onDecide(a.id, true)}>
          Approve
        </button>
        <button className="btn btn-deny" onClick={() => onDecide(a.id, false)}>
          Deny
        </button>
      </div>
    </li>
  )
}

export function OpsColumn({ approvals, runs, halted, onDecide }: Props): React.JSX.Element {
  // Ticks only while something is waiting, for the countdowns.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (approvals.length === 0) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [approvals.length])

  return (
    <section className="frame panel ops" aria-label="Operations">
      <section className="ops-section">
        <h2 className="label">Tasks</h2>
        <p className="empty-note">
          Nothing scheduled. Reminders and scheduled tasks arrive with the scheduler in Phase 3.
        </p>
      </section>

      <section className="ops-section" aria-label="Approvals">
        <h2 className="label">Approvals{approvals.length > 0 ? ` · ${approvals.length}` : ''}</h2>
        {approvals.length === 0 ? (
          <p className="empty-note">
            No requests waiting. Medium-risk actions ask here unless you gave standing permission; high-risk ones always do.
          </p>
        ) : (
          <ul className="approvals">
            {approvals.map((a) => (
              <ApprovalCard key={a.id} a={a} now={now} onDecide={onDecide} />
            ))}
          </ul>
        )}
      </section>

      <section className="ops-section" aria-label="Activity">
        <h2 className="label">Activity</h2>
        {runs.length === 0 ? (
          <p className="empty-note">No actions yet in this workspace. Everything Jarvis does or tries to do is listed here.</p>
        ) : (
          <ol className="runs">
            {runs.slice(0, 8).map((r) => (
              <li key={r.id} className={`run outcome-${r.outcome}`}>
                <time dateTime={new Date(r.createdAt).toISOString()}>{timeOf(r.createdAt)}</time>
                <span className="run-summary" title={r.detail || undefined}>
                  {r.summary}
                </span>
                <span className="run-decision">
                  {r.outcome === 'error' ? 'Failed' : r.outcome === 'skipped' ? `Not done · ${DECISION_LABEL[r.decision]}` : DECISION_LABEL[r.decision]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ops-section">
        <h2 className="label">Execution limits</h2>
        <dl className="limits">
          {LIMIT_ROWS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="fine">
          {halted
            ? 'Stop all is engaged: no actions run until you re-arm.'
            : `Enforced for every typed request. Voice actions are capped at ${LIMITS.toolCallsPerMinute} a minute; helper agents arrive in Phase 4.`}
        </p>
      </section>

      <section className="ops-section">
        <h2 className="label">Integrations</h2>
        <ul className="integrations">
          {INTEGRATIONS.map((i) => (
            <li key={i.name}>
              <span className="int-name">{i.name}</span>
              <span className="int-status">Not connected</span>
              <span className="int-note">{i.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
