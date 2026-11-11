import { useEffect, useState } from 'react'
import { describeCounts, type BackupInfo, type BackupSource, type BackupSummary } from '../../../shared/backup.ts'
import { formatMB } from '../../../shared/perf.ts'

const when = (t: number): string =>
  new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const size = (bytes: number): string => formatMB(bytes / (1024 * 1024))
const KIND_LABEL = { daily: 'Daily', safety: 'Before a restore' } as const

/** Settings → Data (Sprint 18): automatic backups, back up now, restore. Main shows the file dialogs. */
export function BackupsPanel(): React.JSX.Element {
  const [list, setList] = useState<BackupInfo[] | null>(null)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ token: string; summary: BackupSummary } | null>(null)

  const load = (): void => {
    void window.jarvis.backups.list().then((r) => {
      if (r.ok) setList(r.backups)
      else setMsg({ text: r.message, error: true })
    })
  }
  useEffect(load, [])

  const backUp = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    const r = await window.jarvis.backups.create()
    setBusy(false)
    if (r.ok) setMsg({ text: `Saved ${r.fileName} (${size(r.sizeBytes)}).`, error: false })
    else if (!r.cancelled) setMsg({ text: r.message, error: true })
  }

  const inspect = async (source: BackupSource): Promise<void> => {
    setBusy(true)
    setMsg(null)
    const r = await window.jarvis.backups.inspect(source)
    setBusy(false)
    if (r.ok) setConfirm({ token: r.token, summary: r.summary })
    else if (!r.cancelled) setMsg({ text: r.message, error: true })
  }

  const restore = async (): Promise<void> => {
    if (!confirm) return
    setBusy(true)
    const r = await window.jarvis.backups.restore(confirm.token)
    setConfirm(null)
    if (r.ok) {
      setMsg({ text: 'Restored. Your previous data was saved as a backup first. Reloading…', error: false })
      setTimeout(() => window.location.reload(), 900)
    } else {
      setBusy(false)
      setMsg({ text: r.message, error: true })
      load()
    }
  }

  return (
    <div className="backups" aria-label="Backups">
      <p>
        Jarvis backs up its database once a day while it runs and keeps the last 7, on this computer only. Backups hold your
        conversations, memories, reminders, routines, leads and the action log. Keys, webhook addresses and settings are not in them.
      </p>
      <div className="backup-actions">
        <button className="btn" disabled={busy} onClick={() => void backUp()}>
          Back up now…
        </button>
        <button className="btn btn-quiet" disabled={busy} onClick={() => void inspect({ kind: 'file' })}>
          Restore from file…
        </button>
        <button className="btn btn-quiet" onClick={() => void window.jarvis.backups.showFolder()}>
          Show backups folder
        </button>
      </div>
      {msg && <p className={`form-msg ${msg.error ? 'is-error' : 'is-ok'}`}>{msg.text}</p>}

      {confirm && (
        <div className="memory-confirm" role="alertdialog" aria-label="Restore backup">
          <p>
            Restore <strong>{confirm.summary.fileName}</strong> ({when(confirm.summary.modifiedAt)})? It holds{' '}
            {describeCounts(confirm.summary.counts)}. Your current data is saved as a backup first, then replaced.
          </p>
          <div className="memory-actions">
            <button className="vbtn vbtn-end" disabled={busy} onClick={() => void restore()}>
              Restore
            </button>
            <button className="vbtn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <h3 className="subhead">Automatic backups</h3>
      {list === null ? (
        <p className="fine">Reading…</p>
      ) : list.length === 0 ? (
        <p className="fine">None yet. The first one is made a few seconds after Jarvis starts.</p>
      ) : (
        <ul className="backup-list" aria-label="Automatic backups">
          {list.map((b) => (
            <li key={b.name} aria-label={b.name}>
              <span className="backup-when">{when(b.createdAt)}</span>
              <span className="backup-kind">{KIND_LABEL[b.kind]}</span>
              <span className="backup-size">{size(b.sizeBytes)}</span>
              <button className="vbtn" disabled={busy} aria-label={`Restore ${b.name}`} onClick={() => void inspect({ kind: 'auto', name: b.name })}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
