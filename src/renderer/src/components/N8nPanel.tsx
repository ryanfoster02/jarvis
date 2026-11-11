import { useEffect, useState, type FormEvent } from 'react'
import type { N8nStatus } from '../../../shared/n8n.ts'

/** Settings → Connections → n8n (Sprint 21). Read-only oversight of a self-hosted n8n. */
export function N8nPanel(): React.JSX.Element {
  const [status, setStatus] = useState<N8nStatus | null>(null)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    void window.jarvis.n8n.status().then(setStatus)
  }, [])

  const connect = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const r = await window.jarvis.n8n.connect({ url: url.trim(), apiKey: key.trim() })
    setBusy(false)
    setKey('')
    setStatus(r.status)
    if (r.ok) {
      setUrl('')
      setMsg({ text: `Connected: ${r.workflows} workflow${r.workflows === 1 ? '' : 's'}, ${r.active} active.`, error: false })
    } else setMsg({ text: r.message, error: true })
  }

  if (!status) return <div aria-label="n8n" />
  return (
    <div className="repo-allowlist" aria-label="n8n">
      <h3>n8n automations</h3>
      <p className="fine">
        Read-only: Jarvis can see your workflows and which runs failed, for “are my automations OK?” and the morning briefing.
        An n8n API key can do everything in n8n, so JARVIS enforces read-only itself — it only ever reads. Create a key in
        n8n → Settings → n8n API.
      </p>
      {!status.encryptionAvailable && (
        <p className="form-msg is-error">This computer can’t store secrets securely, so n8n can’t be connected here.</p>
      )}
      {status.configured ? (
        <>
          <p className="google-state">
            <span className="status-dot is-ok" aria-hidden="true" />
            Connected · {status.host}
            {!status.https && ' · http (local network only)'}
          </p>
          <div className="backup-actions">
            <button className="btn btn-quiet" onClick={() => void window.jarvis.n8n.remove().then((s) => (setStatus(s), setMsg({ text: 'n8n removed.', error: false })))}>
              Remove n8n
            </button>
          </div>
        </>
      ) : (
        <form className="google-form" onSubmit={(e) => void connect(e)} aria-label="Connect n8n">
          <label>
            <span>n8n address</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://n8n.example.com" autoComplete="off" spellCheck={false} disabled={!status.encryptionAvailable} />
          </label>
          <label>
            <span>n8n API key</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" disabled={!status.encryptionAvailable} />
          </label>
          <div className="backup-actions">
            <button className="btn" type="submit" disabled={busy || !url.trim() || !key.trim() || !status.encryptionAvailable}>
              {busy ? 'Checking…' : 'Connect n8n'}
            </button>
          </div>
        </form>
      )}
      {msg && <p className={`form-msg ${msg.error ? 'is-error' : 'is-ok'}`}>{msg.text}</p>}
    </div>
  )
}
