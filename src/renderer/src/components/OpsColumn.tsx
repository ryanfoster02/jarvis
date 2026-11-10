import { useEffect, useState } from 'react'
import { DEFAULT_LIMITS, type ApprovalRequest, type Reminder, type RunningTask, type ToolRun } from '../../../shared/ipc.ts'
import { formatWhen } from '../../../shared/reminders.ts'
import { DECISION_LABEL } from '../../../shared/tools.ts'
import { LIMITS } from '../../../shared/ratelimit.ts'

// Planned integrations, in rollout order. None are connected in Sprint 2;
// status reflects reality, and there are no buttons that do nothing.
const INTEGRATIONS = [
  { name: 'GitHub', note: 'Read-only: issues, pull requests, commits, files' },
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
  /** Real GitHub state: token saved, and how many repositories are allowed. */
  github: { connected: boolean; repos: number }
  reminders: Reminder[]
  running: RunningTask[]
  onStopTask: (id: string) => void
  onStopAction: (id: string) => void
  reminderActions: {
    add: (text: string, dueAt: number) => Promise<string | null>
    cancel: (id: string) => void
    dismiss: (id: string) => void
    snooze: (id: string, minutes: number) => void
  }
}

/** "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
const localInput = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function RemindersSection({ list, actions }: { list: Reminder[]; actions: Props['reminderActions'] }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [when, setWhen] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const attention = list.filter((r) => r.status === 'fired' || r.status === 'missed')
  const upcoming = list.filter((r) => r.status === 'pending')

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const dueAt = new Date(when).getTime()
    if (!text.trim() || !Number.isFinite(dueAt)) return
    const err = await actions.add(text, dueAt)
    setError(err)
    if (!err) {
      setText('')
      setWhen('')
      setAdding(false)
    }
  }

  return (
    <section className="ops-section" aria-label="Reminders">
      <h2 className="label">Reminders{upcoming.length ? ` · ${upcoming.length}` : ''}</h2>
      {attention.length > 0 && (
        <ul className="approvals">
          {attention.map((r) => (
            <li key={r.id} className={`reminder-alert ${r.status === 'missed' ? 'is-missed' : ''}`}>
              <p className="approval-summary">{r.text}</p>
              <p className="approval-meta">
                {r.status === 'missed' ? `Missed while JARVIS was closed · was due ${formatWhen(r.dueAt, now)}` : `Due ${formatWhen(r.dueAt, now)}`}
              </p>
              <div className="approval-actions">
                <button className="btn" onClick={() => actions.dismiss(r.id)}>
                  Dismiss
                </button>
                <button className="btn btn-quiet" onClick={() => actions.snooze(r.id, 10)}>
                  10 min
                </button>
                <button className="btn btn-quiet" onClick={() => actions.snooze(r.id, 60)}>
                  1 hour
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {upcoming.length === 0 && attention.length === 0 && !adding && (
        <p className="empty-note">Nothing scheduled. Ask Jarvis (&ldquo;remind me at 3pm to call Acme&rdquo;) or add one here.</p>
      )}
      {upcoming.length > 0 && (
        <ol className="runs">
          {upcoming.slice(0, 6).map((r) => (
            <li key={r.id} className="run reminder-row">
              <time dateTime={new Date(r.dueAt).toISOString()}>{formatWhen(r.dueAt, now)}</time>
              <span className="run-summary" title={r.text}>
                {r.text}
              </span>
              <button className="reminder-cancel" aria-label={`Cancel reminder: ${r.text}`} onClick={() => actions.cancel(r.id)}>
                Cancel
              </button>
            </li>
          ))}
        </ol>
      )}
      {upcoming.length > 6 && <p className="fine">and {upcoming.length - 6} more</p>}
      {adding ? (
        <form className="reminder-form" onSubmit={(e) => void submit(e)}>
          <input aria-label="Reminder" placeholder="Remind me to…" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          <input
            aria-label="When"
            type="datetime-local"
            value={when}
            min={localInput(now)}
            onChange={(e) => setWhen(e.target.value)}
          />
          <div className="approval-actions">
            <button className="btn" type="submit" disabled={!text.trim() || !when}>
              Add
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => (setAdding(false), setError(null))}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn btn-quiet btn-small" onClick={() => setAdding(true)}>
          Add reminder
        </button>
      )}
      {error && <p className="form-msg is-error">{error}</p>}
      <p className="fine">Reminders alert while JARVIS is running (window open, or in the menu bar if you turn that on in Settings → Notifications). Anything due while it&apos;s quit shows here as missed.</p>
    </section>
  )
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

function RunningSection({ list, onStopTask, onStopAction }: { list: RunningTask[]; onStopTask: Props['onStopTask']; onStopAction: Props['onStopAction'] }): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (list.length === 0) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [list.length])
  if (list.length === 0) return null
  const secs = (ms: number): string => `${Math.max(0, Math.round((now - ms) / 1000))}s`
  return (
    <section className="ops-section" aria-label="Running">
      <h2 className="label">Running · {list.length}</h2>
      <ul className="approvals">
        {list.map((t) => (
          <li key={t.id} className="running-task">
            <div className="approval-head">
              <span className="running-dot" aria-hidden="true" />
              <span className="approval-title" title={t.title}>
                {t.kind === 'typed' ? `Answering: ${t.title}` : t.title}
              </span>
              <span className="approval-meta">{secs(t.startedAt)}</span>
            </div>
            {t.action && (
              <p className="approval-summary">
                Now: {t.action.title} · {secs(t.action.startedAt)}
              </p>
            )}
            <div className="approval-actions">
              {t.action && (
                <button className="btn btn-quiet" onClick={() => onStopAction(t.id)}>
                  Stop action
                </button>
              )}
              {t.kind === 'typed' && (
                <button className="btn btn-deny" onClick={() => onStopTask(t.id)}>
                  Stop request
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function OpsColumn({
  approvals,
  runs,
  halted,
  onDecide,
  github,
  reminders,
  reminderActions,
  running,
  onStopTask,
  onStopAction,
}: Props): React.JSX.Element {
  const status = (name: string): string => {
    if (name !== 'GitHub' || !github.connected) return 'Not connected'
    return github.repos === 0 ? 'Connected · no repos allowed' : `Connected · ${github.repos} repo${github.repos === 1 ? '' : 's'}`
  }
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
      <RunningSection list={running} onStopTask={onStopTask} onStopAction={onStopAction} />
      <RemindersSection list={reminders} actions={reminderActions} />

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
              <span className={`int-status ${status(i.name).startsWith('Connected') ? 'is-on' : ''}`}>{status(i.name)}</span>
              <span className="int-note">{i.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
