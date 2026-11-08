import { useCallback, useEffect, useState } from 'react'
import { WORKSPACES, type AppInfo, type KillSwitchState, type Settings } from '../../shared/ipc.ts'
import { AiCore, type CoreState } from './components/AiCore.tsx'
import { ConversationPanel } from './components/ConversationPanel.tsx'
import { OpsColumn } from './components/OpsColumn.tsx'
import { SettingsView } from './components/SettingsView.tsx'
import { StateLegend } from './components/StateLegend.tsx'
import { StatusTerminal } from './components/StatusTerminal.tsx'
import { TopBar, type View } from './components/TopBar.tsx'

function statusLine(state: CoreState, kill: KillSwitchState | null, bridgeError: string | null): string {
  if (bridgeError) return bridgeError
  if (kill?.engaged) {
    const at = kill.engagedAt ? new Date(kill.engagedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
    return `Stopped${at ? ` at ${at}` : ''}. Nothing runs until you re-arm.`
  }
  if (state === 'processing') return 'Delivering your message to the main process…'
  return 'Nothing needs you.'
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

  const halted = !!bridgeError || !!kill?.engaged
  const coreState: CoreState = halted ? 'error' : busy ? 'processing' : 'idle'
  const workspace = WORKSPACES.find((w) => w.id === settings?.activeWorkspace) ?? WORKSPACES[0]

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
              <StatusTerminal line={statusLine(coreState, kill, bridgeError)} tone={halted ? 'halted' : 'normal'} />
            </section>

            <ConversationPanel disabled={halted} workspaceName={workspace.name} onBusyChange={setBusy} />
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
