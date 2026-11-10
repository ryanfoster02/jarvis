import { useCallback, useEffect, useRef, useState } from 'react'
import {
  WORKSPACES,
  type AppInfo,
  type ConversationSummary,
  type CredentialStatus,
  type KillSwitchState,
  type NewMessage,
  type Settings,
  type StoredMessage,
} from '../../shared/ipc.ts'
import { estimateCostUsd, totalTokens } from '../../shared/realtime.ts'
import { estimateTextCostUsd } from '../../shared/text.ts'
import { cleanForSpeech, takeSpeakable } from '../../shared/speech.ts'
import { SpeechQueue } from './voice/speechQueue.ts'
import { AiCore, type CoreState } from './components/AiCore.tsx'
import { ConversationPanel, type Entry } from './components/ConversationPanel.tsx'
import { OpsColumn } from './components/OpsColumn.tsx'
import { SettingsView } from './components/SettingsView.tsx'
import { MemoryView } from './components/MemoryView.tsx'
import { parseRememberCommand } from '../../shared/memory.ts'
import { StateLegend } from './components/StateLegend.tsx'
import { StatusTerminal, type Telemetry } from './components/StatusTerminal.tsx'
import { TopBar, type View } from './components/TopBar.tsx'
import { useVoice, type VoiceActivity, type VoicePhase } from './voice/useVoice.ts'

const ACTIVITY_TO_CORE: Record<VoiceActivity, CoreState> = {
  idle: 'listening', // mic is live and waiting
  listening: 'listening',
  thinking: 'processing',
  speaking: 'speaking',
}

function statusLine(o: {
  kill: KillSwitchState | null
  bridgeError: string | null
  voiceError: string | null
  phase: VoicePhase
  activity: VoiceActivity
  muted: boolean
  micPaused: boolean
  busy: boolean
}): string {
  if (o.bridgeError) return o.bridgeError
  if (o.kill?.engaged) {
    const at = o.kill.engagedAt ? new Date(o.kill.engagedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
    return `Stopped${at ? ` at ${at}` : ''}. Nothing runs until you re-arm.`
  }
  if (o.voiceError) return o.voiceError
  if (o.phase === 'connecting') return 'Connecting to OpenAI Realtime…'
  if (o.phase === 'live') {
    if (o.activity === 'speaking')
      return o.micPaused ? 'Speaking. Press Interrupt to cut in (mic paused so I don\'t hear myself).' : 'Speaking. Talk over me or press Interrupt to cut in.'
    if (o.activity === 'thinking') return 'Thinking…'
    if (o.muted) return 'Microphone muted. Unmute to talk, or type.'
    if (o.activity === 'listening') return 'Listening…'
    return 'Voice is on. Go ahead.'
  }
  if (o.busy) return 'Thinking…'
  return 'Nothing needs you.'
}

let entrySeq = 0
const newId = (): string => `e${++entrySeq}`

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [kill, setKill] = useState<KillSwitchState | null>(null)
  const [creds, setCreds] = useState<CredentialStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [usage, setUsage] = useState({ tokens: 0, costUsd: 0 as number | null, latencyMs: null as number | null, ttsChars: 0 })
  const assistantIds = useRef(new Map<string, string>()) // realtime item/response id → entry id
  const assistantText = useRef(new Map<string, string>()) // realtime id → text so far (for saving)

  // ---- Conversation history (stored in main, scoped to the active workspace) ----
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationId, setConversationIdState] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [memoryVersion, setMemoryVersion] = useState(0)

  /** Save a fact for this workspace. Returns an error message, or null when saved. */
  const remember = useCallback(async (text: string, fromConversation: boolean): Promise<string | null> => {
    const r = await window.jarvis.memory.add({ scope: 'workspace', text }, fromConversation)
    if (!r.ok) return r.message
    setMemoryVersion((v) => v + 1)
    return null
  }, [])
  const convIdRef = useRef<string | null>(null)
  const saveChain = useRef<Promise<void>>(Promise.resolve()) // keeps saves in order
  const setConversationId = (id: string | null): void => {
    convIdRef.current = id
    setConversationIdState(id)
  }
  const toEntry = (m: StoredMessage): Entry => ({ id: m.id, role: m.role, text: m.text, at: new Date(m.createdAt), via: m.via })

  const refreshList = useCallback(async (): Promise<ConversationSummary[]> => {
    const r = await window.jarvis.conversations.list()
    if (!r.ok) {
      setHistoryError(r.message)
      return []
    }
    setHistoryError(null)
    setConversations(r.value)
    return r.value
  }, [])

  const openConversation = useCallback(async (id: string | null) => {
    assistantIds.current.clear()
    assistantText.current.clear()
    if (id === null) {
      setConversationId(null)
      setEntries([])
      return
    }
    const r = await window.jarvis.conversations.messages(id)
    if (!r.ok) {
      setHistoryError(r.message)
      return
    }
    setConversationId(id)
    setEntries(r.value.map(toEntry))
  }, [])

  /** Save a turn (voice transcripts); creates the conversation on first save. Saves run in order. */
  const persist = useCallback(
    (m: NewMessage): void => {
      saveChain.current = saveChain.current.then(async () => {
        const r = await window.jarvis.conversations.append(convIdRef.current, m)
        if (r.ok) {
          if (convIdRef.current !== r.value.conversationId) setConversationId(r.value.conversationId)
          await refreshList()
        } else {
          setHistoryError(r.message)
        }
      })
    },
    [refreshList],
  )

  const deleteConversation = useCallback(
    async (id: string) => {
      const r = await window.jarvis.conversations.delete(id)
      if (!r.ok) {
        setHistoryError(r.message)
        return
      }
      const list = await refreshList()
      if (convIdRef.current === id) await openConversation(list[0]?.id ?? null)
    },
    [refreshList, openConversation],
  )
  const [typedSpeaking, setTypedSpeaking] = useState(false)
  const typedSpeech = useRef<SpeechQueue | null>(null)
  if (!typedSpeech.current) {
    // Reads typed replies aloud with the ElevenLabs voice when voice mode is off.
    typedSpeech.current = new SpeechQueue({
      onStart: () => setTypedSpeaking(true),
      onIdle: () => setTypedSpeaking(false),
      onError: (m) => setEntries((e) => [...e, { id: newId(), role: 'system', text: m, at: new Date(), via: 'text' }]),
      onCharacters: (n) => setUsage((prev) => ({ ...prev, ttsChars: prev.ttsChars + n })),
    })
  }

  const push = useCallback((role: Entry['role'], text: string, via: Entry['via']) => {
    setEntries((e) => [...e, { id: newId(), role, text, at: new Date(), via }])
  }, [])

  const voice = useVoice({
    onUserText: (text) => {
      push('user', text, 'voice')
      persist({ role: 'user', text, via: 'voice' })
    },
    onAssistantDelta: (key, delta) => {
      assistantText.current.set(key, (assistantText.current.get(key) ?? '') + delta)
      const existing = assistantIds.current.get(key)
      if (existing) {
        setEntries((es) => es.map((e) => (e.id === existing ? { ...e, text: e.text + delta } : e)))
      } else {
        const id = newId()
        assistantIds.current.set(key, id)
        setEntries((es) => [...es, { id, role: 'assistant', text: delta, at: new Date(), via: 'voice', streaming: true }])
      }
    },
    onAssistantDone: (key, text) => {
      const existing = assistantIds.current.get(key)
      if (existing) {
        setEntries((es) => es.map((e) => (e.id === existing ? { ...e, text: text || e.text, streaming: false } : e)))
      } else if (text) {
        push('assistant', text, 'voice')
      }
      const final = (text || assistantText.current.get(key) || '').trim()
      if (final) persist({ role: 'assistant', text: final, via: 'voice' })
      assistantIds.current.delete(key)
      assistantText.current.delete(key)
    },
    onUsage: (model, u) =>
      setUsage((prev) => {
        const cost = estimateCostUsd(model, u)
        return {
          ...prev,
          tokens: prev.tokens + totalTokens(u),
          costUsd: cost === null || prev.costUsd === null ? null : prev.costUsd + cost,
        }
      }),
    onLatency: (ms) => setUsage((prev) => ({ ...prev, latencyMs: ms })),
    onTtsCharacters: (n) => setUsage((prev) => ({ ...prev, ttsChars: prev.ttsChars + n })),
  })

  useEffect(() => {
    if (!window.jarvis) {
      setBridgeError("Jarvis can't reach its main process: the secure bridge didn't load. Restart the app.")
      return
    }
    Promise.all([
      window.jarvis.settings.get(),
      window.jarvis.app.info(),
      window.jarvis.killSwitch.get(),
      window.jarvis.credentials.status(),
    ])
      .then(([s, i, k, c]) => {
        setSettings(s)
        setInfo(i)
        setKill(k)
        setCreds(c)
      })
      .catch((err: unknown) => setBridgeError(`Jarvis couldn't load its settings: ${String(err)}`))
    return window.jarvis.killSwitch.onChange(setKill)
  }, [])

  // Stop all: tear down voice immediately (mic off, connection closed).
  const stopVoice = voice.stop
  useEffect(() => {
    if (kill?.engaged) {
      stopVoice()
      typedSpeech.current?.stop()
    }
  }, [kill?.engaged, stopVoice])

  // Load this workspace's conversations and open the most recent one. Switching workspace
  // ends any voice session (it was started with the old workspace's context).
  const activeWs = settings?.activeWorkspace
  useEffect(() => {
    if (!activeWs) return
    stopVoice()
    void (async () => {
      const list = await refreshList()
      await openConversation(list[0]?.id ?? null)
    })()
  }, [activeWs, refreshList, openConversation, stopVoice])

  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.dataset.reducedMotion = String(settings.reducedMotion)
  }, [settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setView('settings')
      } else if (e.key === 'Escape') {
        setView('dashboard')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const update = useCallback(async (patch: Partial<Settings>) => {
    try {
      setSettings(await window.jarvis.settings.update(patch))
    } catch (err) {
      setBridgeError(`That setting couldn't be saved: ${String(err)}`)
    }
  }, [])

  const onSend = useCallback(
    async (text: string) => {
      // "/remember <fact>" saves to this workspace's memory; it isn't sent to the model.
      const fact = parseRememberCommand(text)
      if (fact !== null || /^\/remember\s*$/i.test(text.trim())) {
        if (!fact) {
          push('system', 'Type /remember followed by the fact, e.g. /remember Acme renews in March.', 'text')
          return
        }
        const err = await remember(fact, false)
        push('system', err ?? `Remembered for this workspace: “${fact}”`, 'text')
        return
      }
      if (voice.phase === 'live') {
        push('user', text, 'text')
        if (voice.sendText(text)) persist({ role: 'user', text, via: 'text' })
        else push('system', 'Voice is not ready yet. Try again in a moment.', 'text')
        return
      }
      push('user', text, 'text')
      typedSpeech.current?.stop()
      setBusy(true)
      const started = performance.now()
      try {
        await saveChain.current // any pending voice saves first, so the conversation id is current
        const res = await window.jarvis.chat.send(convIdRef.current, text)
        if (res.ok) {
          if (res.conversationId && res.conversationId !== convIdRef.current) setConversationId(res.conversationId)
          void refreshList()
          push('assistant', res.reply, 'text')
          setUsage((prev) => ({
            ...prev,
            tokens: prev.tokens + res.usage.inputTokens + res.usage.outputTokens,
            costUsd: prev.costUsd === null ? null : prev.costUsd + estimateTextCostUsd(res.model, res.usage),
            latencyMs: Math.round(performance.now() - started),
          }))
          if (settings?.speakTypedReplies && settings.speechEngine === 'elevenlabs' && creds?.elevenlabs.configured) {
            for (const chunk of takeSpeakable(res.reply, true).chunks) {
              const clean = cleanForSpeech(chunk)
              if (clean) typedSpeech.current?.enqueue(clean)
            }
          }
        } else {
          push('system', res.message, 'text')
        }
      } catch (err) {
        push('system', `The message couldn't be delivered: ${String(err)}`, 'text')
      } finally {
        setBusy(false)
      }
    },
    [voice, push, persist, refreshList, remember, settings, creds],
  )

  const halted = !!bridgeError || !!kill?.engaged
  const coreState: CoreState = halted
    ? 'error'
    : voice.phase === 'live'
      ? ACTIVITY_TO_CORE[voice.activity]
      : voice.phase === 'connecting' || busy
        ? 'processing'
        : typedSpeaking
          ? 'speaking'
          : 'idle'
  const workspace = WORKSPACES.find((w) => w.id === settings?.activeWorkspace) ?? WORKSPACES[0]
  const elevenActive = voice.engine === 'elevenlabs' || (voice.engine === null && settings?.speechEngine === 'elevenlabs')
  const telemetry: Telemetry = {
    provider: !creds?.openai.configured ? 'None' : elevenActive && creds.elevenlabs.configured ? 'OpenAI + 11L' : 'OpenAI',
    tokens: usage.tokens,
    costUsd: usage.costUsd,
    latencyMs: usage.latencyMs,
    ttsChars: usage.ttsChars,
  }
  const line = statusLine({
    kill,
    bridgeError,
    voiceError: voice.error,
    phase: voice.phase,
    activity: voice.activity,
    muted: voice.muted,
    micPaused: voice.micPaused,
    busy,
  })

  return (
    <div className="shell" data-halted={halted ? 'true' : undefined}>
      <div className="starfield" aria-hidden="true" />
      <TopBar
        view={view}
        onNavigate={setView}
        settings={settings}
        kill={kill}
        onWorkspace={(w) => void update({ activeWorkspace: w })}
        onTheme={(t) => void update({ theme: t })}
        mic={voice.phase === 'live' ? (voice.muted ? 'muted' : voice.micPaused ? 'paused' : 'live') : 'off'}
      />

      <main className="stage">
        {view === 'dashboard' ? (
          <div className="dashboard">
            <div className="col-left">
              <StateLegend current={coreState} />
              <OpsColumn />
            </div>

            <section className="core-stage" aria-label="Jarvis core">
              <AiCore state={coreState} />
              <StatusTerminal
                line={line}
                tone={halted ? 'halted' : voice.error ? 'error' : 'normal'}
                telemetry={telemetry}
              />
            </section>

            <ConversationPanel
              entries={entries}
              onRemember={(text) => remember(text, true)}
              history={{
                conversations,
                currentId: conversationId,
                error: historyError,
                onSelect: (id) => void openConversation(id),
                onNew: () => void openConversation(null),
                onDelete: (id) => void deleteConversation(id),
              }}
              busy={busy}
              disabled={halted}
              workspaceName={workspace.name}
              onSend={onSend}
              onOpenSettings={() => setView('settings')}
              voice={{
                phase: voice.phase,
                activity: voice.activity,
                muted: voice.muted,
                hasKey: !!creds?.openai.configured,
                needsTtsKey: settings?.speechEngine === 'elevenlabs' && !creds?.elevenlabs.configured,
                transcription: voice.transcription,
                onStart: () => void voice.start(),
                onStop: voice.stop,
                onToggleMute: () => voice.setMuted(!voice.muted),
                onInterrupt: voice.interrupt,
              }}
            />
          </div>
        ) : view === 'memory' ? (
          <MemoryView workspaceName={workspace.name} refreshKey={memoryVersion} />
        ) : settings && creds ? (
          <SettingsView
            settings={settings}
            info={info}
            creds={creds}
            onCreds={setCreds}
            onUpdate={(patch) => void update(patch)}
          />
        ) : (
          <p className="loading">Loading settings…</p>
        )}
      </main>
    </div>
  )
}
