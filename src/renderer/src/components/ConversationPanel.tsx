import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MAX_CHAT_CHARS, type ConversationSummary } from '../../../shared/ipc.ts'
import type { VoiceActivity, VoicePhase } from '../voice/useVoice.ts'

export interface Entry {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  at: Date
  via: 'text' | 'voice'
  streaming?: boolean
}

export interface VoiceControls {
  phase: VoicePhase
  activity: VoiceActivity
  muted: boolean
  hasKey: boolean
  /** ElevenLabs is the chosen speech engine but its key is missing. */
  needsTtsKey: boolean
  transcription: boolean
  onStart: () => void
  onStop: () => void
  onToggleMute: () => void
  onInterrupt: () => void
}

export interface HistoryControls {
  conversations: ConversationSummary[]
  currentId: string | null
  error: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

interface Props {
  entries: Entry[]
  history: HistoryControls
  busy: boolean
  disabled: boolean
  workspaceName: string
  voice: VoiceControls
  onSend: (text: string) => Promise<void>
  onOpenSettings: () => void
}

const WHO: Record<Entry['role'], string> = { user: 'You', assistant: 'Jarvis', system: 'Jarvis system' }

const shortDate = (ms: number): string => {
  const d = new Date(ms)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function HistoryBar({ h, disabled }: { h: HistoryControls; disabled: boolean }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const current = h.conversations.find((c) => c.id === h.currentId)
  if (confirming && current) {
    return (
      <div className="history-bar is-confirming" role="alertdialog" aria-label="Delete conversation">
        <span className="history-confirm">
          Delete “{current.title}” and its {current.messageCount} message{current.messageCount === 1 ? '' : 's'}? This can&apos;t be undone.
        </span>
        <button
          className="vbtn vbtn-end"
          onClick={() => {
            setConfirming(false)
            h.onDelete(current.id)
          }}
        >
          Delete
        </button>
        <button className="vbtn" onClick={() => setConfirming(false)}>
          Keep
        </button>
      </div>
    )
  }
  return (
    <div className="history-bar">
      <label className="history-select">
        <span className="sr-only">Conversation</span>
        <select
          value={h.currentId ?? ''}
          onChange={(e) => (e.target.value ? h.onSelect(e.target.value) : h.onNew())}
          disabled={disabled}
        >
          <option value="">New conversation</option>
          {h.conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} · {shortDate(c.updatedAt)}
            </option>
          ))}
        </select>
      </label>
      <button className="vbtn" onClick={h.onNew} disabled={disabled || h.currentId === null} title="Start a new conversation">
        New
      </button>
      <button className="vbtn" onClick={() => setConfirming(true)} disabled={disabled || !current} title="Delete this conversation">
        Delete
      </button>
    </div>
  )
}

export function ConversationPanel({ entries, history, busy, disabled, workspaceName, voice, onSend, onOpenSettings }: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const live = voice.phase === 'live'

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries])

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || busy || disabled) return
    setDraft('')
    await onSend(text)
    inputRef.current?.focus()
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    void send()
  }

  return (
    <section className="frame conversation" aria-label="Conversation">
      <header className="conv-head">
        <h2 className="label">Conversation</h2>
        <span className="conv-scope">{workspaceName}</span>
      </header>

      <HistoryBar h={history} disabled={voice.phase === 'connecting' || voice.phase === 'live' || busy} />
      {history.error && <p className="form-msg is-error">{history.error}</p>}

      <div className="voice-bar">
        {voice.phase === 'off' || voice.phase === 'error' ? (
          voice.hasKey && voice.needsTtsKey ? (
            <button className="vbtn" onClick={onOpenSettings}>
              Add ElevenLabs key for Jarvis&apos;s voice
            </button>
          ) : voice.hasKey ? (
            <button className="vbtn vbtn-primary" onClick={voice.onStart} disabled={disabled}>
              <span className="vbtn-dot" aria-hidden="true" />
              Start voice
            </button>
          ) : (
            <button className="vbtn" onClick={onOpenSettings}>
              Add OpenAI key to enable voice
            </button>
          )
        ) : voice.phase === 'connecting' ? (
          <button className="vbtn" disabled>
            Connecting…
          </button>
        ) : (
          <>
            <button className="vbtn vbtn-end" onClick={voice.onStop}>
              End voice
            </button>
            <button className="vbtn" aria-pressed={voice.muted} onClick={voice.onToggleMute}>
              {voice.muted ? 'Unmute' : 'Mute'}
            </button>
            <button className="vbtn" onClick={voice.onInterrupt} disabled={voice.activity !== 'speaking'}>
              Interrupt
            </button>
          </>
        )}
      </div>

      <ol className="messages" ref={listRef} aria-live="polite">
        {entries.length === 0 && (
          <li className="conv-empty">
            {voice.hasKey ? (
              <p>Type a message, or start voice and say hello.</p>
            ) : (
              <>
                <p>Add your OpenAI key in Settings to talk with Jarvis.</p>
                <p className="fine">Until then, Jarvis can receive messages but can't reply.</p>
              </>
            )}
          </li>
        )}
        {entries.map((m) => (
          <li key={m.id} className={`msg msg-${m.role} ${m.streaming ? 'is-streaming' : ''}`}>
            <div className="msg-meta">
              <span className="msg-who">{WHO[m.role]}</span>
              <time dateTime={m.at.toISOString()}>
                {m.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </time>
              {m.via === 'voice' && <span className="msg-via">voice</span>}
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

      {live && !voice.transcription && (
        <p className="fine conv-note">Your spoken words aren't transcribed in this session; Jarvis's replies still are.</p>
      )}

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
          placeholder={disabled ? 'Re-arm Jarvis to send messages' : live ? 'Type to Jarvis (replies by voice)' : 'Message Jarvis'}
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
