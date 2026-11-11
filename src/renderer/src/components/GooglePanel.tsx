import { useEffect, useState, type FormEvent } from 'react'
import type { GoogleResult, GoogleStatus } from '../../../shared/google.ts'

/** Settings → Connections → Google (Sprint 19). Read-only calendar access via the owner's own OAuth client. */
export function GooglePanel(): React.JSX.Element {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    void window.jarvis.google.status().then(setStatus)
  }, [])

  const apply = (r: GoogleResult, ok: string): void => {
    setStatus(r.status)
    setMsg(r.ok ? { text: ok, error: false } : { text: r.message, error: true })
  }

  const saveClient = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const r = await window.jarvis.google.saveClient({ clientId: clientId.trim(), clientSecret: secret.trim() || null })
    setSecret('')
    if (r.ok) {
      setClientId('')
      setEditing(false)
    }
    apply(r, 'OAuth client saved. Now connect your Google account.')
  }

  const connect = async (): Promise<void> => {
    setMsg({ text: 'Finish signing in to Google in your browser…', error: false })
    setStatus((s) => (s ? { ...s, connecting: true } : s))
    const r = await window.jarvis.google.connect()
    apply(r, `Connected${r.status.email ? ` as ${r.status.email}` : ''}.`)
  }

  if (!status) return <div aria-label="Google" />
  const showForm = !status.clientSaved || editing

  return (
    <div className="repo-allowlist google-panel" aria-label="Google">
      <h3>Google Calendar</h3>
      <p className="fine">
        Read-only: Jarvis can see your calendars to answer “what’s on today?” or “when am I free?”, but can’t create, change or
        answer events. Uses your own Google OAuth client (type <em>Desktop app</em>, with the Google Calendar API enabled).
      </p>
      <p className="fine">
        If Google says <em>redirect_uri_mismatch</em>, the client isn&apos;t a Desktop app client (a <em>Web application</em> client
        only accepts fixed addresses). Create a Desktop app client in Google Cloud → Clients and use <em>Change client</em> here.
      </p>

      {!status.encryptionAvailable && (
        <p className="form-msg is-error">This computer can’t store secrets securely, so Google can’t be connected here.</p>
      )}

      {status.connected && (
        <p className="google-state">
          <span className={`status-dot ${status.needsReconnect ? 'is-warn' : 'is-ok'}`} aria-hidden="true" />
          {status.needsReconnect ? 'Sign-in expired' : 'Connected'}
          {status.email ? ` · ${status.email}` : ''}
          {status.connectedAt ? ` · since ${new Date(status.connectedAt).toLocaleDateString()}` : ''}
        </p>
      )}

      {showForm ? (
        <form className="google-form" onSubmit={(e) => void saveClient(e)} aria-label="Google OAuth client">
          <label>
            <span>Google client ID</span>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123…-….apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
              disabled={!status.encryptionAvailable}
            />
          </label>
          <label>
            <span>Google client secret</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="GOCSPX-…"
              autoComplete="off"
              disabled={!status.encryptionAvailable}
            />
          </label>
          <div className="backup-actions">
            <button className="btn" type="submit" disabled={!clientId.trim() || !status.encryptionAvailable}>
              Save client
            </button>
            {editing && (
              <button className="btn btn-quiet" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          <p className="fine">OAuth client {status.clientHint ? `from project ${status.clientHint}` : ''} saved (encrypted).</p>
          <div className="backup-actions">
            {status.connecting ? (
              <>
                <button className="btn" disabled>
                  Waiting for the browser…
                </button>
                <button className="btn btn-quiet" onClick={() => void window.jarvis.google.cancel()}>
                  Cancel sign-in
                </button>
              </>
            ) : !status.connected || status.needsReconnect ? (
              <button className="btn" onClick={() => void connect()}>
                {status.needsReconnect ? 'Reconnect Google' : 'Connect Google'}
              </button>
            ) : (
              <button
                className="btn btn-quiet"
                onClick={() => void window.jarvis.google.disconnect(false).then((r) => apply(r, 'Disconnected. Google access was revoked.'))}
              >
                Disconnect
              </button>
            )}
            <button className="btn btn-quiet" onClick={() => setEditing(true)}>
              Change client
            </button>
            <button
              className="btn btn-quiet"
              onClick={() => void window.jarvis.google.disconnect(true).then((r) => apply(r, 'Google client and access removed.'))}
            >
              Remove
            </button>
          </div>
        </>
      )}
      {msg && <p className={`form-msg ${msg.error ? 'is-error' : 'is-ok'}`}>{msg.text}</p>}
    </div>
  )
}
