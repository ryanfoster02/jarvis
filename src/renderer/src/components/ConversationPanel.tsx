import { useRef, useState, type FormEvent } from 'react'
import { MAX_CHAT_CHARS } from '../../../shared/ipc.ts'

interface Entry {
  id: number
  role: 'user' | 'assistant' | 'system'
  text: string
}

interface Props {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
}

export function ConversationPanel({ disabled, onBusyChange }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)
  const listRef = useRef<HTMLOListElement>(null)

  const push = (role: Entry['role'], text: string): void => {
    setEntries((e) => [...e, { id: nextId.current++, role, text }])
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }))
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy || disabled) return
    setDraft('')
    push('user', text)
    setBusy(true)
    onBusyChange(true)
    try {
      const res = await window.jarvis.chat.send(text)
      push(res.ok ? 'assistant' : 'system', res.ok ? res.reply : res.message)
    } catch (err) {
      push('system', `Request failed: ${String(err)}`)
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }

  return (
    <div className="panel conversation">
      <div className="panel-head">
        <h2>Conversation</h2>
        <span className="pill pill-muted">Text · voice in Sprint 3</span>
      </div>

      <ol className="messages" ref={listRef}>
        {entries.length === 0 && (
          <li className="empty">No messages yet. Messages go to the main process; replies need an AI provider, which isn't connected yet.</li>
        )}
        {entries.map((m) => (
          <li key={m.id} className={`msg msg-${m.role}`}>
            <span className="msg-who">{m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Jarvis' : 'System'}</span>
            <p>{m.text}</p>
          </li>
        ))}
      </ol>

      <form className="composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={disabled ? 'Unavailable while halted' : 'Message Jarvis…'}
          maxLength={MAX_CHAT_CHARS}
          disabled={disabled}
          aria-label="Message"
        />
        <button type="submit" disabled={disabled || busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
