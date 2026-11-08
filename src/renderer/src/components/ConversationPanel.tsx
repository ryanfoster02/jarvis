import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MAX_CHAT_CHARS } from '../../../shared/ipc.ts'

interface Entry {
  id: number
  role: 'user' | 'assistant' | 'system'
  text: string
  at: Date
}

interface Props {
  disabled: boolean
  workspaceName: string
  onBusyChange: (busy: boolean) => void
}

const WHO: Record<Entry['role'], string> = { user: 'You', assistant: 'Jarvis', system: 'Jarvis system' }

export function ConversationPanel({ disabled, workspaceName, onBusyChange }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)
  const listRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries])

  const push = (role: Entry['role'], text: string): void =>
    setEntries((e) => [...e, { id: nextId.current++, role, text, at: new Date() }])

  const send = async (): Promise<void> => {
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
      push('system', `The message couldn't be delivered: ${String(err)}`)
    } finally {
      setBusy(false)
      onBusyChange(false)
      inputRef.current?.focus()
    }
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    void send()
  }

  return (
    <section className="conversation glass" aria-label="Conversation">
      <header className="conv-head">
        <h2>Conversation</h2>
        <span className="conv-scope">{workspaceName}</span>
      </header>

      <ol className="messages" ref={listRef} aria-live="polite">
        {entries.length === 0 && (
          <li className="conv-empty">
            <p>Ask Jarvis something to get started.</p>
            <p className="fine">
              Replies need an AI provider, which isn't connected yet — Jarvis will tell you that rather than make
              something up. Voice arrives in Sprint 3.
            </p>
          </li>
        )}
        {entries.map((m) => (
          <li key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-meta">
              <span className="msg-who">{WHO[m.role]}</span>
              <time dateTime={m.at.toISOString()}>
                {m.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </time>
            </div>
            <p>{m.text}</p>
          </li>
        ))}
        {busy && (
          <li className="msg msg-pending" aria-label="Waiting for Jarvis">
            <span />
            <span />
            <span />
          </li>
        )}
      </ol>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={disabled ? 'Re-arm Jarvis to send messages' : 'Message Jarvis'}
          maxLength={MAX_CHAT_CHARS}
          disabled={disabled}
          aria-label="Message"
        />
        <button type="submit" disabled={disabled || busy || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}
