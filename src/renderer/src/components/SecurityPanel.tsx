import type { KillSwitchState } from '../../../shared/ipc.ts'

export function SecurityPanel({ state }: { state: KillSwitchState | null }): React.JSX.Element {
  const engaged = !!state?.engaged
  return (
    <div className={`panel security ${engaged ? 'is-halted' : ''}`}>
      <div className="panel-head">
        <h2>Security</h2>
        <span className={`pill ${engaged ? 'pill-danger' : 'pill-ok'}`}>{engaged ? 'Halted' : 'Armed'}</span>
      </div>
      <p className="muted small">
        Global stop refuses all execution until re-armed. Shortcut <kbd>⌘</kbd>
        <kbd>⇧</kbd>
        <kbd>.</kbd>
      </p>
      {engaged ? (
        <button className="btn btn-secondary" onClick={() => void window.jarvis.killSwitch.rearm()}>
          Re-arm Jarvis
        </button>
      ) : (
        <button className="btn btn-danger" onClick={() => void window.jarvis.killSwitch.engage('Emergency stop (dashboard)')}>
          Emergency Stop
        </button>
      )}
      {engaged && state?.engagedAt && (
        <p className="muted small">Engaged {new Date(state.engagedAt).toLocaleTimeString()}</p>
      )}
    </div>
  )
}
