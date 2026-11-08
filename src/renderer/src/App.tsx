import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, KillSwitchState, Settings, Theme } from '../../shared/ipc.ts'
import { AiCore, type CoreState } from './components/AiCore.tsx'
import { ConversationPanel } from './components/ConversationPanel.tsx'
import { SystemPanel } from './components/SystemPanel.tsx'
import { SecurityPanel } from './components/SecurityPanel.tsx'
import { ThemeSwitcher } from './components/ThemeSwitcher.tsx'

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [kill, setKill] = useState<KillSwitchState | null>(null)
  const [busy, setBusy] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.jarvis) {
      setBridgeError('Secure bridge unavailable — preload script did not load.')
      return
    }
    Promise.all([window.jarvis.settings.get(), window.jarvis.app.info(), window.jarvis.killSwitch.get()])
      .then(([s, i, k]) => {
        setSettings(s)
        setInfo(i)
        setKill(k)
      })
      .catch((err: unknown) => setBridgeError(String(err)))
    return window.jarvis.killSwitch.onChange(setKill)
  }, [])

  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion)
  }, [settings])

  const changeTheme = useCallback(async (theme: Theme) => {
    setSettings(await window.jarvis.settings.update({ theme }))
  }, [])

  const coreState: CoreState = bridgeError || kill?.engaged ? 'error' : busy ? 'processing' : 'idle'

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">J.A.R.V.I.S.</span>
          <span className="brand-sub">local · v{info?.version ?? '—'}</span>
        </div>
        <div className="topbar-right">
          {settings && <ThemeSwitcher value={settings.theme} onChange={changeTheme} />}
        </div>
      </header>

      {bridgeError && <div className="banner banner-error">{bridgeError}</div>}
      {kill?.engaged && (
        <div className="banner banner-error">
          Emergency stop engaged{kill.reason ? ` — ${kill.reason}` : ''}. All execution is refused until you re-arm.
        </div>
      )}

      <main className="grid">
        <section className="col col-left">
          <SystemPanel info={info} />
          <SecurityPanel state={kill} />
        </section>

        <section className="col col-center">
          <AiCore state={coreState} />
        </section>

        <section className="col col-right">
          <ConversationPanel disabled={!!bridgeError || !!kill?.engaged} onBusyChange={setBusy} />
        </section>
      </main>
    </div>
  )
}
