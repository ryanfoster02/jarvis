import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { LEAD_STATUSES, type Lead, type LeadInput, type LeadStatus } from '../../../shared/ipc.ts'
import { OPEN_STATUSES, pipelineSummary, STATUS_LABEL, todayIso } from '../../../shared/leads.ts'

// Local leads pipeline (Sprint 15). Jarvis can read it, and add or update leads with your approval.

interface Props {
  workspaceName: string
  refreshKey: number
}

const money = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

const empty = (): LeadInput => ({ name: '', company: '', email: '', status: 'new', value: 0, notes: '', nextStep: '', nextDate: null })

function LeadForm({ initial, onDone }: { initial: LeadInput; onDone: (msg: string | null) => void }): React.JSX.Element {
  const [d, setD] = useState<LeadInput>(initial)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<LeadInput>): void => setD((x) => ({ ...x, ...patch }))
  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const r = await window.jarvis.leads.save(d)
    if (r.ok) onDone(d.id ? 'Lead saved.' : 'Lead added.')
    else setError(r.message)
  }
  return (
    <form className="frame panel workflow-editor lead-form" onSubmit={(e) => void save(e)} aria-label="Lead editor">
      <h2 className="label">{d.id ? 'Edit lead' : 'New lead'}</h2>
      <div className="lead-grid">
        <label className="wf-field">
          <span className="field-label">Name</span>
          <input value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} aria-label="Lead name" />
        </label>
        <label className="wf-field">
          <span className="field-label">Company</span>
          <input value={d.company} maxLength={80} onChange={(e) => set({ company: e.target.value })} aria-label="Company" />
        </label>
        <label className="wf-field">
          <span className="field-label">Email</span>
          <input value={d.email} maxLength={120} type="email" onChange={(e) => set({ email: e.target.value })} aria-label="Email" />
        </label>
        <label className="wf-field">
          <span className="field-label">Stage</span>
          <select className="select" value={d.status} onChange={(e) => set({ status: e.target.value as LeadStatus })} aria-label="Stage">
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="wf-field">
          <span className="field-label">Value</span>
          <input
            value={d.value || ''}
            inputMode="numeric"
            onChange={(e) => set({ value: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
            aria-label="Value"
          />
        </label>
        <label className="wf-field">
          <span className="field-label">Next step date</span>
          <input type="date" value={d.nextDate ?? ''} onChange={(e) => set({ nextDate: e.target.value || null })} aria-label="Next step date" />
        </label>
      </div>
      <label className="wf-field">
        <span className="field-label">Next step</span>
        <input value={d.nextStep} maxLength={200} onChange={(e) => set({ nextStep: e.target.value })} aria-label="Next step" />
      </label>
      <label className="wf-field">
        <span className="field-label">Notes</span>
        <textarea value={d.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" />
      </label>
      {error && <p className="form-msg is-error">{error}</p>}
      <div className="memory-actions">
        <button type="submit" className="vbtn vbtn-primary" disabled={!d.name.trim()}>
          {d.id ? 'Save' : 'Add'}
        </button>
        <button type="button" className="vbtn" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function LeadsView({ workspaceName, refreshKey }: Props): React.JSX.Element {
  const [list, setList] = useState<Lead[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<LeadInput | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const load = useCallback(async () => {
    const r = await window.jarvis.leads.list()
    if (r.ok) {
      setList(r.value)
      setLoadError(null)
    } else setLoadError(r.message)
  }, [])
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const done = (msg: string | null, tone: 'ok' | 'error' = 'ok'): void => {
    setNotice(msg ? { tone, text: msg } : null)
    void load()
  }
  const setStage = async (l: Lead, status: LeadStatus): Promise<void> => {
    const { id, workspaceId: _w, createdAt: _c, updatedAt: _u, ...rest } = l
    const r = await window.jarvis.leads.save({ ...rest, id, status })
    if (!r.ok) done(r.message, 'error')
    else void load()
  }
  const remove = async (id: string): Promise<void> => {
    const r = await window.jarvis.leads.delete(id)
    setConfirming(null)
    done(r.ok ? 'Lead deleted.' : r.message, r.ok ? 'ok' : 'error')
  }

  const now = Date.now()
  const today = todayIso(now)
  const sum = list ? pipelineSummary(list, now) : null
  const shown = (list ?? []).filter((l) => showClosed || OPEN_STATUSES.includes(l.status))

  return (
    <div className="memory-view">
      <header className="memory-head">
        <div>
          <h1>Leads</h1>
          <p>
            Your pipeline in {workspaceName}, stored on this computer. Jarvis can read it, and add or update leads with your
            approval — e.g. &ldquo;add Ada from Acme as qualified, follow up Friday&rdquo;. Try the <em>Weekly pipeline report</em>{' '}
            routine.
          </p>
        </div>
        {!editing && (
          <button className="btn" onClick={() => setEditing(empty())} disabled={!!loadError}>
            New lead
          </button>
        )}
      </header>

      {loadError && <p className="form-msg is-error">{loadError}</p>}
      {notice && <p className={`form-msg ${notice.tone === 'error' ? 'is-error' : 'is-ok'}`}>{notice.text}</p>}

      {sum && list && list.length > 0 && (
        <section className="frame panel pipeline" aria-label="Pipeline">
          {LEAD_STATUSES.map((s) => (
            <div key={s} className={`pipeline-stage stage-${s}`}>
              <span className="stage-name">{STATUS_LABEL[s]}</span>
              <span className="stage-count">{sum.byStatus[s].count}</span>
              <span className="stage-value">{money(sum.byStatus[s].value)}</span>
            </div>
          ))}
          <p className="pipeline-foot">
            Open: {sum.openCount} worth {money(sum.openValue)}
            {sum.overdue.length > 0 && <span className="overdue"> · {sum.overdue.length} overdue next step{sum.overdue.length === 1 ? '' : 's'}</span>}
          </p>
        </section>
      )}

      {editing && (
        <LeadForm
          key={editing.id ?? 'new'}
          initial={editing}
          onDone={(msg) => {
            setEditing(null)
            done(msg)
          }}
        />
      )}

      <section className="frame panel">
        <div className="lead-list-head">
          <h2 className="label">{showClosed ? 'All leads' : 'Open leads'}</h2>
          <label className="wf-check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show won and lost
          </label>
        </div>
        {list === null ? (
          <p className="fine">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="empty-note">{list.length === 0 ? 'No leads yet.' : 'No open leads.'}</p>
        ) : (
          <ul className="memory-list">
            {shown.map((l) => (
              <li key={l.id} className="lead-item" aria-label={l.name}>
                <div className="wf-row">
                  <div className="wf-main">
                    <h3 className="wf-name">
                      {l.name}
                      {l.company && <span className="lead-company"> · {l.company}</span>}
                    </h3>
                    <p className="memory-meta">
                      <span>
                        {l.nextStep || 'No next step'}
                        {l.nextDate && (
                          <span className={l.nextDate < today && OPEN_STATUSES.includes(l.status) ? 'overdue' : ''}> · {l.nextDate}</span>
                        )}
                      </span>
                      <span>{l.value ? money(l.value) : ''}</span>
                    </p>
                  </div>
                  <select
                    className="select"
                    value={l.status}
                    aria-label={`Stage for ${l.name}`}
                    onChange={(e) => void setStage(l, e.target.value as LeadStatus)}
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                {confirming === l.id ? (
                  <div className="memory-confirm" role="alertdialog" aria-label="Delete lead">
                    <p>Delete {l.name}? This can&apos;t be undone.</p>
                    <div className="memory-actions">
                      <button className="vbtn vbtn-end" onClick={() => void remove(l.id)}>
                        Delete
                      </button>
                      <button className="vbtn" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="memory-actions">
                    <button
                      className="link-btn"
                      onClick={() => {
                        const { workspaceId: _w, createdAt: _c, updatedAt: _u, ...rest } = l
                        setEditing(rest)
                      }}
                    >
                      Edit
                    </button>
                    <button className="link-btn danger" onClick={() => setConfirming(l.id)}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
