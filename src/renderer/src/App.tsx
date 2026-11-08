import { useCallback, useEffect, useState } from 'react'
import { WORKSPACES, type AppInfo, type KillSwitchState, type Settings, type Theme, type WorkspaceId } from '../../shared/ipc.ts'
import { AiCore, CORE_LABELS, type CoreState } from './components/AiCore.tsx'
import { ConversationPanel } from './components/ConversationPanel.tsx'
import { OpsColumn } from './components/OpsColumn.tsx'
import { Rail, type View } from './components/Rail.tsx'
import { SettingsView } from './components/SettingsView.tsx'
import { TopBar } from './components/TopBar.tsx'

function readout(state: CoreState, kill: KillSwitchState | null, bridgeError: string | null): string {
  if (bridgeError) return bridgeError
  if (kill?.engaged) {
    const at = kill.engagedAt ? new Date(kill.engagedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
    return `Emergency stop engaged${at ? ` at ${at}` : ''}. Nothing will run until you re-arm.`
  }
  if (state === 'processing') return 'Passing your message to the main process.'
  return "Ready for text. Jarvis receives your messages but can't reply until an AI provider is connected."
}

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [kill, setKill] = useState<KillSwitchState | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [bridgeError, setBridgeError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.jarvis) {
      setBridgeError("Jarvis can't reach its main process: the secure bridge didn't load. Restart the app.")
      return
    }
    Promise.all([window.jarvis.settings.get(), window.jarvis.app.info(), window.jarvis.killSwitch.get()])
      .then(([s, i, k]) => {
        setSettings(s)
        setInfo(i)
        setKill(k)
      })
      .catch((err: unknown) => setBridgeError(`Jarvis couldn't load its settings: ${String(err)}`))
    return window.jarvis.killSwitch.onChange(setKill)
  }, [])

  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.dataset.reducedMotion = String(settings.reducedMotion)
  }, [settings])

  // ⌘, opens settings; Esc returns to the dashboard.
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

  const coreState: CoreState = bridgeError || kill?.engaged ? 'error' : busy ? 'processing' : 'idle'
  const workspace = WORKSPACES.find((w) => w.id === settings?.activeWorkspace) ?? WORKSPACES[0]

  return (
    <div className="shell" data-halted={kill?.engaged ? 'true' : undefined}>
      <TopBar
        settings={settings}
        onWorkspace={(w: WorkspaceId) => void update({ activeWorkspace: w })}
        onTheme={(t: Theme) => void update({ theme: t })}
      />
      <Rail view={view} onNavigate={setView} kill={kill} />

      <main className="stage">
        {view === 'dashboard' ? (
          <div className="dashboard">
            <OpsColumn />

            <section className="core-stage" aria-label="Jarvis status">
              <AiCore state={coreState} />
              <div className="readout" role="status" aria-live="polite">
                <p className="readout-state">{CORE_LABELS[coreState]}</p>
                <p className="readout-detail">{readout(coreState, kill, bridgeError)}</p>
              </div>
            </section>

            <ConversationPanel
              disabled={!!bridgeError || !!kill?.engaged}
              workspaceName={workspace.name}
              onBusyChange={setBusy}
            />
          </div>
        ) : settings ? (
          <SettingsView
            settings={settings}
            info={info}
            onTheme={(t) => void update({ theme: t })}
            onReducedMotion={(v) => void update({ reducedMotion: v })}
          />
        ) : (
          <p className="loading">Loading settings…</p>
        )}
      </main>
    </div>
  )
}
