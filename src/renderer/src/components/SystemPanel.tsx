import type { AppInfo } from '../../../shared/ipc.ts'

const PLATFORM: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function SystemPanel({ info }: { info: AppInfo | null }): React.JSX.Element {
  const rows: Array<[string, string, 'ok' | 'off' | 'pending']> = info
    ? [
        ['Platform', `${PLATFORM[info.platform] ?? info.platform} · ${info.arch}`, 'ok'],
        ['Electron', info.versions.electron, 'ok'],
        ['Chromium', info.versions.chrome, 'ok'],
        ['Node', info.versions.node, 'ok'],
        ['Build', info.isPackaged ? 'Packaged' : 'Development', 'ok'],
        ['AI provider', 'Not configured', 'off'],
        ['Voice', 'Sprint 3', 'pending'],
        ['Memory', 'Phase 2', 'pending'],
        ['Integrations', 'Phase 3', 'pending'],
      ]
    : []

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>System</h2>
      </div>
      {info ? (
        <dl className="kv">
          {rows.map(([k, v, s]) => (
            <div key={k} className="kv-row">
              <dt>{k}</dt>
              <dd>
                <span className={`status-dot status-${s}`} />
                {v}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">Reading system state…</p>
      )}
    </div>
  )
}
