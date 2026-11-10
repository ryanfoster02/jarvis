import { THEMES, WORKSPACES, type KillSwitchState, type Settings, type Theme, type WorkspaceId } from '../../../shared/ipc.ts'
import { THEME_NAMES } from './ThemeSwitcher.tsx'

export type View = 'dashboard' | 'memory' | 'settings'

interface Props {
  view: View
  onNavigate: (v: View) => void
  settings: Settings | null
  kill: KillSwitchState | null
  onWorkspace: (w: WorkspaceId) => void
  onTheme: (t: Theme) => void
  mic: 'off' | 'live' | 'muted' | 'paused'
}

const Mark = (): React.JSX.Element => (
  <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" />
    <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="12" cy="12" r="2.6" fill="currentColor" />
  </svg>
)

export function TopBar({ view, onNavigate, settings, kill, onWorkspace, onTheme, mic }: Props): React.JSX.Element {
  const halted = !!kill?.engaged
  const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] ?? 'gold'

  return (
    <header className="topbar">
      <div className="topbar-frame frame">
        <div className="brand">
          <Mark />
          <span className="wordmark">JARVIS</span>
        </div>

        <nav className="nav" aria-label="Main">
          <button aria-current={view === 'dashboard' ? 'page' : undefined} onClick={() => onNavigate('dashboard')}>
            Dashboard
          </button>
          <button aria-current={view === 'memory' ? 'page' : undefined} onClick={() => onNavigate('memory')}>
            Memory
          </button>
          <button
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => onNavigate('settings')}
            title="Settings (⌘,)"
          >
            Settings
          </button>
        </nav>

        <div className="topbar-spacer" />

        {mic !== 'off' && (
          <span className={`chip chip-mic ${mic === 'live' ? 'is-live' : ''}`} role="status">
            <span className="mic-dot" aria-hidden="true" />
            {mic === 'live' ? 'Mic live' : mic === 'paused' ? 'Mic paused' : 'Mic muted'}
          </span>
        )}

        {settings && (
          <>
            <label className="chip chip-select">
              <span className={`live-dot ${halted ? 'is-halted' : ''}`} aria-hidden="true" />
              <span className="sr-only">Workspace</span>
              <select value={settings.activeWorkspace} onChange={(e) => onWorkspace(e.target.value as WorkspaceId)}>
                {WORKSPACES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="chip"
              onClick={() => onTheme(nextTheme(settings.theme))}
              title="Switch theme"
            >
              Theme: {THEME_NAMES[settings.theme]}
            </button>
          </>
        )}

        {halted ? (
          <button className="chip chip-rearm" onClick={() => void window.jarvis.killSwitch.rearm()}>
            Re-arm
          </button>
        ) : (
          <button
            className="chip chip-stop"
            onClick={() => void window.jarvis.killSwitch.engage('Stop all (dashboard)')}
            title="Stop all execution (⌘⇧.)"
          >
            <span className="stop-square" aria-hidden="true" />
            Stop all
          </button>
        )}
      </div>
    </header>
  )
}
