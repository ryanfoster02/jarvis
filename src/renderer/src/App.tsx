import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  textModelProvider,
  type ActionNote,
  type ApprovalRequest,
  type Reminder,
  type RunningTask,
  type ToolRun,
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
import { parseRememberCommand } from '../../shared/memory.ts'
import { describeAction } from '../../shared/tools.ts'
import { StateLegend } from './components/StateLegend.tsx'
import { StatusTerminal, type Telemetry } from './components/StatusTerminal.tsx'
import { TopBar, type View } from './components/TopBar.tsx'
import { useVoice, type VoiceActivity, type VoicePhase } from './voice/useVoice.ts'
import { shouldCalm } from '../../shared/perf.ts'
import { SetupGuide } from './components/SetupGuide.tsx'
import type { SettingsSection } from './components/SettingsView.tsx'

// Screens other than the dashboard load on first visit (Sprint 16), keeping startup lean.
const SettingsView = lazy(() => import('./components/SettingsView.tsx').then((m) => ({ default: m.SettingsView })))
const MemoryView = lazy(() => import('./components/MemoryView.tsx').then((m) => ({ default: m.MemoryView })))
const WorkflowsView = lazy(() => import('./components/WorkflowsView.tsx').then((m) => ({ default: m.WorkflowsView })))
const LeadsView = lazy(() => import('./components/LeadsView.tsx').then((m) => ({ default: m.LeadsView })))

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
  approvals: number
  reminder: string | null
}): string {
  if (o.bridgeError) return o.bridgeError
  if (o.kill?.engaged) {
    const at = o.kill.engagedAt ? new Date(o.kill.engagedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
    return `Stopped${at ? ` at ${at}` : ''}. Nothing runs until you re-arm.`
  }
  if (o.voiceError) return o.voiceError
  if (o.reminder) return `Reminder: ${o.reminder}`
  if (o.approvals > 0) return o.approvals === 1 ? 'Waiting for your approval (see Approvals).' : `${o.approvals} requests waiting for your approval.`
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


/** Is the provider behind the typed-replies model connected? */
function textReady(creds: CredentialStatus | null, settings: Settings | null): boolean {
  if (!creds || !settings) return false
  return creds[textModelProvider(settings.textModel)].configured
}

/** Real connected services only, e.g. "OpenAI + Claude + 11L". */
function providerLabel(creds: CredentialStatus | null, settings: Settings | null, elevenActive: boolean): string {
  if (!creds) return 'None'
  const parts: string[] = []
  if (creds.openai.configured) parts.push('OpenAI')
  if (creds.anthropic.configured && settings && textModelProvider(settings.textModel) === 'anthropic') parts.push('Claude')
  if (parts.length && elevenActive && creds.elevenlabs.configured) parts.push('11L')
  return parts.length ? parts.join(' + ') : 'None'
}

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [kill, setKill] = useState<KillSwitchState | null>(null)
  const [creds, setCreds] = useState<CredentialStatus | null>(null)
  // Latest values for long-lived event listeners (registered once).
  const settingsRef = useRef<Settings | null>(null)
  const credsRef = useRef<CredentialStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  // Which Settings section to open when a link (the setup guide) asks for one.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined)
  const openSettings = useCallback((section: SettingsSection) => {
    setSettingsSection(section)
    setView('settings')
  }, [])
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

  // ---- Tools: approvals waiting for the owner, and the action log (Sprint 8) ----
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [runs, setRuns] = useState<ToolRun[]>([])
  const [runsVersion, setRunsVersion] = useState(0)
  const onAction = useCallback((note: ActionNote, via: Entry['via']) => {
    const tone = note.outcome === 'ok' ? 'ok' : note.outcome === 'error' ? 'error' : 'skipped'
    setEntries((e) => [...e, { id: newId(), role: 'action', text: describeAction(note), at: new Date(), via, tone, ...(note.links?.length ? { links: note.links } : {}) }])
  }, [])

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

  settingsRef.current = settings
  credsRef.current = creds

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
    onAction: (note) => onAction(note, 'voice'),
  })

  useEffect(() => {
    if (!window.jarvis) return
    void window.jarvis.approvals.list().then(setApprovals)
    const offApprovals = window.jarvis.approvals.onChange(setApprovals)
    // Main announces every logged action: refresh the Activity list, and Memory if it changed.
    const offLogged = window.jarvis.tools.onLogged((note) => {
      setRunsVersion((v) => v + 1)
      if (note.outcome === 'ok' && (note.tool === 'save_memory' || note.tool === 'forget_memory')) setMemoryVersion((v) => v + 1)
    })
    return () => {
      offApprovals()
      offLogged()
    }
  }, [])

  // ---- Saved routines (Sprint 13): results go to the conversation of their workspace ----
  const [workflowsVersion, setWorkflowsVersion] = useState(0)
  useEffect(() => {
    if (!window.jarvis) return
    const offChanged = window.jarvis.workflows.onChanged(() => setWorkflowsVersion((v) => v + 1))
    const offFinished = window.jarvis.workflows.onFinished((n) => {
      if (n.workspaceId !== settingsRef.current?.activeWorkspace) return
      const tone = n.run.status === 'ok' ? undefined : 'error'
      const head = n.run.status === 'ok' ? n.workflowName : `${n.workflowName} (${n.run.status === 'cancelled' ? 'stopped' : 'failed'})`
      setEntries((e) => [...e, { id: newId(), role: 'workflow', text: `${head}\n${n.run.output}`, at: new Date(), via: 'text', ...(tone ? { tone } : {}) }])
    })
    return () => {
      offChanged()
      offFinished()
    }
  }, [])

  // ---- Leads (Sprint 15): reload when Jarvis changes them ----
  const [leadsVersion, setLeadsVersion] = useState(0)
  useEffect(() => {
    if (!window.jarvis) return
    return window.jarvis.leads.onChanged(() => setLeadsVersion((v) => v + 1))
  }, [])

  // ---- Running tasks and stop levels (Sprint 11) ----
  const [running, setRunning] = useState<RunningTask[]>([])
  useEffect(() => {
    if (!window.jarvis) return
    void window.jarvis.tasks.list().then(setRunning)
    return window.jarvis.tasks.onChange(setRunning)
  }, [])
  const typedTask = [...running].reverse().find((t) => t.kind === 'typed') ?? null

  // ---- Reminders (Sprint 10): fire in main while the app runs; shown and managed here ----
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [remindersVersion, setRemindersVersion] = useState(0)
  useEffect(() => {
    if (!window.jarvis) return
    const offChanged = window.jarvis.reminders.onChanged(() => setRemindersVersion((v) => v + 1))
    const offFired = window.jarvis.reminders.onFired((r) => {
      // Only this workspace's reminders go into the conversation; others still notify via macOS.
      if (r.workspaceId !== settingsRef.current?.activeWorkspace) return
      setEntries((e) => [...e, { id: newId(), role: 'reminder', text: r.text, at: new Date(), via: 'text' }])
      const s = settingsRef.current
      if (s?.speakTypedReplies && s.speechEngine === 'elevenlabs' && credsRef.current?.elevenlabs.configured) {
        typedSpeech.current?.enqueue(cleanForSpeech(`Reminder: ${r.text}`))
      }
    })
    return () => {
      offChanged()
      offFired()
    }
  }, [])
  const remindersWorkspace = settings?.activeWorkspace
  useEffect(() => {
    if (!window.jarvis || !remindersWorkspace) return
    let live = true
    void window.jarvis.reminders.list().then((r) => {
      if (live) setReminders(r.ok ? r.value : [])
    })
    return () => {
      live = false
    }
  }, [remindersWorkspace, remindersVersion])
  const reminderActions = {
    add: async (text: string, dueAt: number): Promise<string | null> => {
      const r = await window.jarvis.reminders.add(text, dueAt)
      return r.ok ? null : r.message
    },
    cancel: (id: string) => void window.jarvis.reminders.cancel(id),
    dismiss: (id: string) => void window.jarvis.reminders.dismiss(id),
    snooze: (id: string, minutes: number) => void window.jarvis.reminders.snooze(id, minutes),
  }

  // Action log for the active workspace: reload on workspace switch and after each action.
  const runsWorkspace = settings?.activeWorkspace
  useEffect(() => {
    if (!window.jarvis || !runsWorkspace) return
    let live = true
    void window.jarvis.tools.runs().then((r) => {
      if (live) setRuns(r.ok ? r.value : [])
    })
    return () => {
      live = false
    }
  }, [runsWorkspace, runsVersion])

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
      try {
        const list = await refreshList()
        await openConversation(list[0]?.id ?? null)
      } finally {
        // Startup timeline: the dashboard has its data (main keeps only the first report).
        void window.jarvis.perf.dashboardReady().catch(() => undefined)
      }
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
        setSettingsSection(undefined)
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
          for (const a of res.actions) onAction(a, 'text')
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
          for (const a of res.actions ?? []) onAction(a, 'text')
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
  // Pause idle animation while nobody is looking (Sprint 16): hidden/minimised, or in the
  // background while standing by. Waiting approvals and running tasks keep their motion.
  const calmState = approvals.length > 0 ? 'needs-you' : running.length > 0 ? 'executing' : coreState
  useEffect(() => {
    const root = document.documentElement
    const apply = (): void => {
      root.dataset.calm = String(shouldCalm({ hidden: document.hidden, focused: document.hasFocus(), state: calmState }))
    }
    apply()
    document.addEventListener('visibilitychange', apply)
    window.addEventListener('focus', apply)
    window.addEventListener('blur', apply)
    return () => {
      document.removeEventListener('visibilitychange', apply)
      window.removeEventListener('focus', apply)
      window.removeEventListener('blur', apply)
    }
  }, [calmState])

  const workspace = WORKSPACES.find((w) => w.id === settings?.activeWorkspace) ?? WORKSPACES[0]
  const elevenActive = voice.engine === 'elevenlabs' || (voice.engine === null && settings?.speechEngine === 'elevenlabs')
  const telemetry: Telemetry = {
    provider: providerLabel(creds, settings, elevenActive),
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
    approvals: approvals.length,
    reminder: reminders.find((r) => r.status === 'fired')?.text ?? null,
  })

  return (
    <div className="shell" data-halted={halted ? 'true' : undefined}>
      <div className="starfield" aria-hidden="true" />
      <TopBar
        view={view}
        onNavigate={(v) => {
          setSettingsSection(undefined)
          setView(v)
        }}
        settings={settings}
        kill={kill}
        onWorkspace={(w) => void update({ activeWorkspace: w })}
        onTheme={(t) => void update({ theme: t })}
        mic={voice.phase === 'live' ? (voice.muted ? 'muted' : voice.micPaused ? 'paused' : 'live') : 'off'}
        approvalsWaiting={approvals.length}
      />

      <main className="stage">
        {view === 'dashboard' ? (
          <div className="dashboard">
            <div className="col-left">
              {settings && creds && !settings.setupGuideDismissed && (
                <SetupGuide
                  settings={settings}
                  creds={creds}
                  hasConversations={conversations.length > 0}
                  onOpenSettings={openSettings}
                  onDismiss={() => void update({ setupGuideDismissed: true })}
                />
              )}
              <StateLegend current={coreState} />
              <OpsColumn
                approvals={approvals}
                runs={runs}
                halted={halted}
                onDecide={(id, approve) => void window.jarvis.approvals.decide(id, approve)}
                github={{ connected: !!creds?.github.configured, repos: settings?.githubRepos.length ?? 0 }}
                reminders={reminders}
                reminderActions={reminderActions}
                running={running}
                onStopTask={(id) => void window.jarvis.tasks.cancel(id)}
                onStopAction={(id, actionId) => void window.jarvis.tasks.cancelAction(id, actionId)}
              />
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
              onStop={typedTask ? () => void window.jarvis.tasks.cancel(typedTask.id) : null}
              onOpenSettings={() => setView('settings')}
              voice={{
                phase: voice.phase,
                activity: voice.activity,
                muted: voice.muted,
                hasKey: !!creds?.openai.configured,
                textReady: textReady(creds, settings),
                needsTtsKey: settings?.speechEngine === 'elevenlabs' && !creds?.elevenlabs.configured,
                transcription: voice.transcription,
                onStart: () => void voice.start(),
                onStop: voice.stop,
                onToggleMute: () => voice.setMuted(!voice.muted),
                onInterrupt: voice.interrupt,
              }}
            />
          </div>
        ) : (
          <Suspense fallback={<p className="loading">Loading…</p>}>
            {view === 'memory' ? (
              <MemoryView workspaceName={workspace.name} refreshKey={memoryVersion} />
            ) : view === 'leads' ? (
              <LeadsView workspaceName={workspace.name} refreshKey={leadsVersion} />
            ) : view === 'routines' ? (
              <WorkflowsView workspaceName={workspace.name} refreshKey={workflowsVersion} halted={halted} />
            ) : settings && creds ? (
              <SettingsView
                key={settingsSection ?? 'default'}
                initialSection={settingsSection}
                settings={settings}
                info={info}
                creds={creds}
                onCreds={setCreds}
                onUpdate={(patch) => void update(patch)}
              />
            ) : (
              <p className="loading">Loading settings…</p>
            )}
          </Suspense>
        )}
      </main>
    </div>
  )
}
