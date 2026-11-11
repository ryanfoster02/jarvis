import { useEffect, useState } from 'react'
import type { AutomationReport } from '../../../shared/n8n.ts'

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')

/** Dashboard: n8n health over the last 24 hours (Sprint 21). Shown only while n8n is connected. */
export function AutomationsPanel(): React.JSX.Element | null {
  const [configured, setConfigured] = useState(false)
  const [report, setReport] = useState<{ report: AutomationReport; links: Record<string, string> } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const st = await window.jarvis.n8n.status()
      if (!alive) return
      setConfigured(st.configured)
      if (!st.configured) return
      const r = await window.jarvis.n8n.report()
      if (!alive) return
      if (r.ok) {
        setReport({ report: r.report, links: r.links })
        setError(null)
      } else setError(r.message)
    }
    void load()
    const timer = setInterval(() => void load(), 10 * 60_000)
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (!configured) return null
  const r = report?.report
  return (
    <section className="frame panel automations" aria-label="Automations">
      <h2 className="label">Automations</h2>
      {error ? (
        <p className="form-msg is-error">{error}</p>
      ) : !r ? (
        <p className="empty-note">Checking n8n…</p>
      ) : (
        <>
          <p className={r.failing.length ? 'automations-bad' : 'automations-ok'}>
            {r.workflows.active} active workflow{r.workflows.active === 1 ? '' : 's'} ·{' '}
            {r.failing.length ? `${r.failing.length} failing in the last 24 h` : 'no failures in the last 24 h'}
          </p>
          {r.failing.length > 0 && (
            <ul className="today-list">
              {r.failing.slice(0, 5).map((f) => (
                <li key={f.workflowId}>
                  <span className="today-time">{when(f.lastFailedAt)}</span>
                  <span className="today-title" title={f.name}>
                    {f.name} {f.failures > 1 ? `(${f.failures}×)` : ''}
                  </span>
                  {report?.links[f.workflowId] && (
                    <a className="today-meet" href={report.links[f.workflowId]} target="_blank" rel="noreferrer noopener">
                      Open
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
