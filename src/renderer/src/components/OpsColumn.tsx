import { DEFAULT_LIMITS } from '../../../shared/ipc.ts'

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
  ['Helper agents', `${DEFAULT_LIMITS.maxConcurrentAgents} at once, no nesting`],
]

export function OpsColumn(): React.JSX.Element {
  return (
    <section className="frame panel ops" aria-label="Operations">
      <section className="ops-section">
        <h2 className="label">Tasks</h2>
        <p className="empty-note">
          Nothing scheduled. Reminders and scheduled tasks arrive with the scheduler in Phase 3.
        </p>
      </section>

      <section className="ops-section">
        <h2 className="label">Approvals</h2>
        <p className="empty-note">
          No requests waiting. When Jarvis wants to send, delete, publish or spend, the request appears here
          for you to approve.
        </p>
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
        <p className="fine">Enforced once the agent runtime ships in Phase 2.</p>
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
