import type { KillSwitchState } from '../../../shared/ipc.ts'

export type View = 'dashboard' | 'settings'

interface Props {
  view: View
  onNavigate: (v: View) => void
  kill: KillSwitchState | null
}

const DashboardIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="3" fill="currentColor" />
  </svg>
)
const SettingsIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

export function Rail({ view, onNavigate, kill }: Props): React.JSX.Element {
  const halted = !!kill?.engaged
  return (
    <nav className="rail" aria-label="Main">
      <button
        className="rail-btn"
        aria-current={view === 'dashboard' ? 'page' : undefined}
        onClick={() => onNavigate('dashboard')}
        title="Dashboard"
      >
        <DashboardIcon />
        <span className="sr-only">Dashboard</span>
      </button>
      <button
        className="rail-btn"
        aria-current={view === 'settings' ? 'page' : undefined}
        onClick={() => onNavigate('settings')}
        title="Settings (⌘,)"
      >
        <SettingsIcon />
        <span className="sr-only">Settings</span>
      </button>

      <div className="rail-spacer" />

      {halted ? (
        <button className="stop stop-rearm" onClick={() => void window.jarvis.killSwitch.rearm()} title="Re-arm Jarvis">
          Re-arm
        </button>
      ) : (
        <button
          className="stop"
          onClick={() => void window.jarvis.killSwitch.engage('Emergency stop (dashboard)')}
          title="Emergency stop (⌘⇧.)"
        >
          Stop
        </button>
      )}
    </nav>
  )
}
