import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Memory, MemoryScope } from '../../../shared/ipc.ts'
import { MAX_MEMORY_CHARS } from '../../../shared/memory.ts'

interface Props {
  workspaceName: string
  /** Bumped by the parent when memories change elsewhere (Remember button, /remember). */
  refreshKey: number
}

const when = (ms: number): string =>
  new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })

function MemoryItem({ m, onChanged }: { m: Memory; onChanged: (msg: string | null) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState(m.text)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    const r = await window.jarvis.memory.update(m.id, draft)
    if (r.ok) {
      setEditing(false)
      setError(null)
      onChanged(null)
    } else setError(r.message)
  }
  const remove = async (): Promise<void> => {
    const r = await window.jarvis.memory.delete(m.id)
    onChanged(r.ok ? 'Memory deleted.' : r.message)
  }

  return (
    <li className="memory-item">
      {editing ? (
        <div className="memory-edit">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={MAX_MEMORY_CHARS} aria-label="Edit memory" />
          <div className="memory-actions">
            <button className="vbtn vbtn-primary" onClick={() => void save()} disabled={!draft.trim()}>
              Save
            </button>
            <button
              className="vbtn"
              onClick={() => {
                setEditing(false)
                setDraft(m.text)
                setError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : confirming ? (
        <div className="memory-confirm" role="alertdialog" aria-label="Delete memory">
          <p>Delete “{m.text}”? This can&apos;t be undone.</p>
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
        <>
          <p className="memory-text">{m.text}</p>
          <div className="memory-meta">
            <span>
              {m.source === 'conversation' ? 'From a conversation' : 'Added by you'} · {when(m.updatedAt)}
            </span>
            <span className="memory-actions">
              <button className="link-btn" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="link-btn danger" onClick={() => setConfirming(true)}>
                Delete
              </button>
            </span>
          </div>
        </>
      )}
      {error && <p className="form-msg is-error">{error}</p>}
    </li>
  )
}

export function MemoryView({ workspaceName, refreshKey }: Props): React.JSX.Element {
  const [items, setItems] = useState<Memory[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [scope, setScope] = useState<MemoryScope>('workspace')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await window.jarvis.memory.list()
    if (r.ok) {
      setItems(r.value)
      setLoadError(null)
    } else setLoadError(r.message)
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey, workspaceName])

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const r = await window.jarvis.memory.add({ scope, text })
    if (r.ok) {
      setText('')
      setNotice({ tone: 'ok', text: 'Saved. Jarvis will use this from the next reply.' })
      await load()
    } else setNotice({ tone: 'error', text: r.message })
  }

  const exportAll = async (): Promise<void> => {
    const r = await window.jarvis.memory.export()
    if (r.ok) setNotice({ tone: 'ok', text: `Exported ${r.count} memor${r.count === 1 ? 'y' : 'ies'} to ${r.path}` })
    else if (!r.cancelled) setNotice({ tone: 'error', text: r.message })
  }

  const workspaceItems = items.filter((m) => m.scope === 'workspace')
  const globalItems = items.filter((m) => m.scope === 'global')
  const changed = (msg: string | null): void => {
    if (msg) setNotice({ tone: msg.endsWith('deleted.') ? 'ok' : 'error', text: msg })
    void load()
  }

  return (
    <div className="memory-view">
      <header className="memory-head">
        <div>
          <h1>Memory</h1>
          <p>
            Facts Jarvis knows about you and your work. It uses them in typed and spoken replies, treats them as
            information (never instructions), and never stores passwords or keys.
          </p>
        </div>
        <button className="btn btn-quiet" onClick={() => void exportAll()} disabled={!!loadError}>
          Export all (JSON)
        </button>
      </header>

      {loadError && <p className="form-msg is-error">{loadError}</p>}
      {notice && <p className={`form-msg ${notice.tone === 'error' ? 'is-error' : 'is-ok'}`}>{notice.text}</p>}

      <form className="frame panel memory-add" onSubmit={(e) => void add(e)}>
        <h2 className="label">Remember something</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Acme's contract renews every March"
          maxLength={MAX_MEMORY_CHARS}
          aria-label="New memory"
          disabled={!!loadError}
        />
        <div className="memory-add-row">
          <label className="scope-choice">
            <span>Applies to</span>
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)}>
              <option value="workspace">This workspace ({workspaceName})</option>
              <option value="global">All workspaces</option>
            </select>
          </label>
          <span className="fine">
            {text.length}/{MAX_MEMORY_CHARS}
          </span>
          <button type="submit" className="btn" disabled={!text.trim() || !!loadError}>
            Remember
          </button>
        </div>
        <p className="fine">Tip: in the conversation, type “/remember …” or use the Remember button under a message.</p>
      </form>

      <div className="memory-columns">
        <section className="frame panel">
          <h2 className="label">{workspaceName}</h2>
          {workspaceItems.length === 0 ? (
            <p className="empty-note">Nothing saved for this workspace yet.</p>
          ) : (
            <ul className="memory-list">
              {workspaceItems.map((m) => (
                <MemoryItem key={m.id} m={m} onChanged={changed} />
              ))}
            </ul>
          )}
        </section>
        <section className="frame panel">
          <h2 className="label">All workspaces</h2>
          {globalItems.length === 0 ? (
            <p className="empty-note">Nothing saved for every workspace yet.</p>
          ) : (
            <ul className="memory-list">
              {globalItems.map((m) => (
                <MemoryItem key={m.id} m={m} onChanged={changed} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
