import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Workflow, WorkflowInput, WorkflowRun } from '../../../shared/ipc.ts'
import { formatWhen } from '../../../shared/reminders.ts'
import { PT } from '../platform.ts'
import { describeSchedule, MAX_WORKFLOW_INSTRUCTIONS, MAX_WORKFLOW_NAME, WORKFLOW_TEMPLATES } from '../../../shared/workflows.ts'

// Saved routines (Sprint 13): create, schedule, run now, and read past results.

interface Props {
  workspaceName: string
  /** Bumped by the parent when routines change elsewhere (runs finishing, the scheduler). */
  refreshKey: number
  halted: boolean
}

const DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
] as const

const STATUS: Record<WorkflowRun['status'], string> = { running: 'Running…', ok: 'Finished', error: 'Failed', cancelled: 'Stopped' }

type Draft = Omit<WorkflowInput, 'schedule'> & { scheduled: boolean; days: number[]; time: string }

const emptyDraft = (): Draft => ({ name: '', instructions: '', enabled: true, scheduled: false, days: [1, 2, 3, 4, 5], time: '07:30' })

const toDraft = (w: Pick<Workflow, 'name' | 'instructions' | 'schedule' | 'enabled'> & { id?: string }): Draft => ({
  ...(w.id ? { id: w.id } : {}),
  name: w.name,
  instructions: w.instructions,
  enabled: w.enabled,
  scheduled: !!w.schedule,
  days: w.schedule?.days ?? [1, 2, 3, 4, 5],
  time: w.schedule?.time ?? '07:30',
})

function Editor({ initial, onDone }: { initial: Draft; onDone: (msg: string | null) => void }): React.JSX.Element {
  const [d, setD] = useState<Draft>(initial)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>): void => setD((x) => ({ ...x, ...patch }))

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const input: WorkflowInput = {
      ...(d.id ? { id: d.id } : {}),
      name: d.name,
      instructions: d.instructions,
      enabled: d.enabled,
      schedule: d.scheduled ? { days: d.days, time: d.time } : null,
    }
    const r = await window.jarvis.workflows.save(input)
    if (r.ok) onDone(d.id ? 'Routine saved.' : 'Routine created.')
    else setError(r.message)
  }

  return (
    <form className="frame panel workflow-editor" onSubmit={(e) => void save(e)} aria-label="Routine editor">
      <h2 className="label">{d.id ? 'Edit routine' : 'New routine'}</h2>
      {!d.id && (
        <div className="templates" aria-label="Templates">
          <span className="fine">Start from:</span>
          {WORKFLOW_TEMPLATES.map((t) => (
            <button key={t.name} type="button" className="link-btn" onClick={() => setD({ ...toDraft({ ...t, enabled: true }) })}>
              {t.name}
            </button>
          ))}
        </div>
      )}
      <label className="wf-field">
        <span className="field-label">Name</span>
        <input value={d.name} maxLength={MAX_WORKFLOW_NAME} onChange={(e) => set({ name: e.target.value })} aria-label="Routine name" />
      </label>
      <label className="wf-field">
        <span className="field-label">What Jarvis should do</span>
        <textarea
          value={d.instructions}
          maxLength={MAX_WORKFLOW_INSTRUCTIONS}
          onChange={(e) => set({ instructions: e.target.value })}
          aria-label="Routine instructions"
          placeholder="e.g. Tell me today's reminders, then check my repositories for new issues and summarise what needs attention."
        />
      </label>
      <div className="wf-schedule">
        <label className="wf-check">
          <input type="checkbox" checked={d.scheduled} onChange={(e) => set({ scheduled: e.target.checked })} />
          Run on a schedule
        </label>
        {d.scheduled && (
          <>
            <div className="wf-days" role="group" aria-label="Days">
              {DAYS.map(([n, label]) => (
                <label key={n} className={`wf-day ${d.days.includes(n) ? 'is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={d.days.includes(n)}
                    onChange={(e) => set({ days: e.target.checked ? [...d.days, n] : d.days.filter((x) => x !== n) })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="wf-time">
              at
              <input type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} aria-label="Time" />
            </label>
          </>
        )}
      </div>
      {d.scheduled && (
        <p className="fine">
          Scheduled runs happen only while JARVIS is running (window open, or {PT.tray} mode), and can only look things up:
          anything that needs an action is reported for you to do or approve.
        </p>
      )}
      <label className="wf-check">
        <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Active (a paused routine keeps its settings but never runs on its schedule)
      </label>
      {error && <p className="form-msg is-error">{error}</p>}
      <div className="memory-actions">
        <button type="submit" className="vbtn vbtn-primary" disabled={!d.name.trim() || !d.instructions.trim()}>
          {d.id ? 'Save' : 'Create'}
        </button>
        <button type="button" className="vbtn" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function WorkflowItem({
  w,
  now,
  halted,
  onEdit,
  onChanged,
}: {
  w: Workflow
  now: number
  halted: boolean
  onEdit: () => void
  onChanged: (msg: string | null, tone?: 'ok' | 'error') => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    void window.jarvis.workflows.runs(w.id).then((r) => live && setRuns(r.ok ? r.value : []))
    return () => {
      live = false
    }
  }, [open, w.id, w.lastRun?.id, w.lastRun?.status])

  const run = async (): Promise<void> => {
    const r = await window.jarvis.workflows.run(w.id)
    if (r.ok) {
      setOpen(true)
      onChanged(`Running "${w.name}". The result appears here and in the conversation.`)
    } else onChanged(r.message, 'error')
  }
  const remove = async (): Promise<void> => {
    const r = await window.jarvis.workflows.delete(w.id)
    onChanged(r.ok ? 'Routine deleted.' : r.message, r.ok ? 'ok' : 'error')
  }
  const last = w.lastRun
  const running = last?.status === 'running'

  return (
    <li className="workflow-item" aria-label={w.name}>
      <div className="wf-row">
        <div className="wf-main">
          <h3 className="wf-name">{w.name}</h3>
          <p className="memory-meta">
            <span>
              {describeSchedule(w.schedule)}
              {w.schedule && (w.enabled ? (w.nextRunAt ? ` · next ${formatWhen(w.nextRunAt, now)}` : '') : ' · paused')}
            </span>
            {last && (
              <span className={`wf-status status-${last.status}`}>
                {STATUS[last.status]} {formatWhen(last.finishedAt ?? last.startedAt, now)}
              </span>
            )}
          </p>
        </div>
        <div className="memory-actions">
          <button className="btn" onClick={() => void run()} disabled={halted || running}>
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>
      </div>
      {confirming ? (
        <div className="memory-confirm" role="alertdialog" aria-label="Delete routine">
          <p>Delete “{w.name}” and its results? This can&apos;t be undone.</p>
          <div className="memory-actions">
            <button className="vbtn vbtn-end" onClick={() => void remove()}>
              Delete
            </button>
            <button className="vbtn" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="memory-actions">
          <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide results' : 'Results'}
          </button>
          <button className="link-btn" onClick={onEdit}>
            Edit
          </button>
          <button className="link-btn danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        </div>
      )}
      {open && (
        <ol className="wf-runs" aria-label={`Results for ${w.name}`}>
          {runs === null ? (
            <li className="fine">Loading…</li>
          ) : runs.length === 0 ? (
            <li className="empty-note">No runs yet.</li>
          ) : (
            runs.map((r) => (
              <li key={r.id} className={`wf-run status-${r.status}`}>
                <p className="memory-meta">
                  <span>
                    {STATUS[r.status]} · {formatWhen(r.startedAt, now)} · {r.trigger === 'schedule' ? 'scheduled' : 'run by you'}
                  </span>
                  {r.actions > 0 && <span>{r.actions} action{r.actions === 1 ? '' : 's'}</span>}
                </p>
                {r.output && <p className="wf-output">{r.output}</p>}
              </li>
            ))
          )}
        </ol>
      )}
    </li>
  )
}

export function WorkflowsView({ workspaceName, refreshKey, halted }: Props): React.JSX.Element {
  const [list, setList] = useState<Workflow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const r = await window.jarvis.workflows.list()
    if (r.ok) {
      setList(r.value)
      setLoadError(null)
    } else setLoadError(r.message)
    setNow(Date.now())
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const changed = (msg: string | null, tone: 'ok' | 'error' = 'ok'): void => {
    setNotice(msg ? { tone, text: msg } : null)
    void load()
  }

  return (
    <div className="memory-view">
      <header className="memory-head">
        <div>
          <h1>Routines</h1>
          <p>
            Saved instructions Jarvis runs when you ask, or on a schedule in {workspaceName}. They follow the same permissions,
            approvals and limits as everything else. Scheduled runs only look things up, and only while JARVIS is running.
          </p>
        </div>
        {!editing && (
          <button className="btn" onClick={() => setEditing(emptyDraft())} disabled={!!loadError}>
            New routine
          </button>
        )}
      </header>

      {loadError && <p className="form-msg is-error">{loadError}</p>}
      {notice && <p className={`form-msg ${notice.tone === 'error' ? 'is-error' : 'is-ok'}`}>{notice.text}</p>}
      {halted && <p className="form-msg is-error">Stop all is engaged: routines won&apos;t run until you re-arm.</p>}

      {editing && (
        <Editor
          key={editing.id ?? 'new'}
          initial={editing}
          onDone={(msg) => {
            setEditing(null)
            changed(msg)
          }}
        />
      )}

      <section className="frame panel">
        <h2 className="label">{workspaceName}</h2>
        {list === null ? (
          <p className="fine">Loading…</p>
        ) : list.length === 0 ? (
          <p className="empty-note">No routines yet. Create one, or start from a template such as a morning briefing.</p>
        ) : (
          <ul className="memory-list">
            {list.map((w) => (
              <WorkflowItem key={w.id} w={w} now={now} halted={halted} onEdit={() => setEditing(toDraft(w))} onChanged={changed} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
