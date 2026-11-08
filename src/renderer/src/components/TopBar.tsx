import { WORKSPACES, type Settings, type Theme, type WorkspaceId } from '../../../shared/ipc.ts'
import { ThemeSwitcher } from './ThemeSwitcher.tsx'

interface Props {
  settings: Settings | null
  onWorkspace: (w: WorkspaceId) => void
  onTheme: (t: Theme) => void
}

export function TopBar({ settings, onWorkspace, onTheme }: Props): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="wordmark" aria-label="J.A.R.V.I.S.">
        J.A.R.V.I.S.
      </div>

      {settings && (
        <label className="workspace">
          <span className="sr-only">Workspace</span>
          <select
            value={settings.activeWorkspace}
            onChange={(e) => onWorkspace(e.target.value as WorkspaceId)}
            title="Switch workspace"
          >
            {WORKSPACES.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="topbar-spacer" />
      {settings && <ThemeSwitcher value={settings.theme} onChange={onTheme} />}
    </header>
  )
}
