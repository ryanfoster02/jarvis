import { useState } from 'react'
import type { AppInfo, Settings, Theme } from '../../../shared/ipc.ts'
import { AiCore, CORE_LABELS, CORE_STATES, type CoreState } from './AiCore.tsx'
import { ThemeSwitcher } from './ThemeSwitcher.tsx'

type Section = 'appearance' | 'voice' | 'provider' | 'permissions' | 'notifications' | 'connections' | 'about'

const SECTIONS: Array<[Section, string]> = [
  ['appearance', 'Appearance'],
  ['voice', 'Voice'],
  ['provider', 'AI provider'],
  ['permissions', 'Permissions'],
  ['notifications', 'Notifications'],
  ['connections', 'Connections'],
  ['about', 'About'],
]

const PLATFORM: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

interface Props {
  settings: Settings
  info: AppInfo | null
  onTheme: (t: Theme) => void
  onReducedMotion: (v: boolean) => void
}

export function SettingsView({ settings, info, onTheme, onReducedMotion }: Props): React.JSX.Element {
  const [section, setSection] = useState<Section>('appearance')
  const [preview, setPreview] = useState<CoreState>('idle')

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <h1>Settings</h1>
        {SECTIONS.map(([id, label]) => (
          <button key={id} aria-current={section === id ? 'true' : undefined} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="settings-body frame">
        {section === 'appearance' && (
          <>
            <h2>Appearance</h2>
            <div className="field">
              <div className="field-text">
                <h3>Theme</h3>
                <p>Changes the accent across Jarvis. Saved on this Mac.</p>
              </div>
              <ThemeSwitcher value={settings.theme} onChange={onTheme} showNames />
            </div>
            <div className="field">
              <div className="field-text">
                <h3>Reduce motion</h3>
                <p>Stops the core's continuous animation. State changes still show through colour.</p>
              </div>
              <button
                role="switch"
                aria-checked={settings.reducedMotion}
                className="switch"
                onClick={() => onReducedMotion(!settings.reducedMotion)}
              >
                <span className="sr-only">Reduce motion</span>
              </button>
            </div>
            <div className="field field-stack">
              <div className="field-text">
                <h3>Core states</h3>
                <p>Preview how the core looks in each state. This doesn't change what Jarvis is doing.</p>
              </div>
              <div className="preview">
                <AiCore state={preview} size="small" />
                <div className="preview-states" role="radiogroup" aria-label="Preview state">
                  {CORE_STATES.map((s) => (
                    <button key={s} role="radio" aria-checked={preview === s} onClick={() => setPreview(s)}>
                      {CORE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {section === 'voice' && (
          <>
            <h2>Voice</h2>
            <p className="status-line">
              <span className="dot dot-pending" /> Not available yet — arriving in Sprint 3.
            </p>
            <p>
              Jarvis will talk through OpenAI's realtime voice model (gpt-realtime-mini during development). You'll
              choose a voice, mute the microphone, and interrupt Jarvis mid-sentence. The microphone is only on
              while you've started a conversation, and a visible indicator shows when it is.
            </p>
          </>
        )}

        {section === 'provider' && (
          <>
            <h2>AI provider</h2>
            <p className="status-line">
              <span className="dot dot-off" /> No provider connected.
            </p>
            <p>
              You'll add your OpenAI API key here in Sprint 3. It's stored encrypted in your Mac's keychain and never
              shown to the interface. Anthropic Claude can be added as a second provider later.
            </p>
          </>
        )}

        {section === 'permissions' && (
          <>
            <h2>Permissions</h2>
            <p>Every action Jarvis can take has a risk level. These rules can't be overridden by standing permissions you grant later.</p>
            <table className="risk-table">
              <thead>
                <tr>
                  <th scope="col">Risk</th>
                  <th scope="col">Examples</th>
                  <th scope="col">What happens</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="risk-low">Low</th>
                  <td>Reading your approved data, searching</td>
                  <td>Allowed and logged</td>
                </tr>
                <tr>
                  <th scope="row" className="risk-med">Medium</th>
                  <td>Creating files, editing project code, preparing drafts</td>
                  <td>Asks you, unless you've given standing permission</td>
                </tr>
                <tr>
                  <th scope="row" className="risk-high">High</th>
                  <td>Deleting, sending messages, publishing code, spending money</td>
                  <td>Always asks you, every time</td>
                </tr>
              </tbody>
            </table>
            <p className="fine">The agent runtime that applies these rules ships in Phase 2. Today Jarvis can't take any actions.</p>
          </>
        )}

        {section === 'notifications' && (
          <>
            <h2>Notifications</h2>
            <p className="status-line">
              <span className="dot dot-off" /> Not available yet.
            </p>
            <p>Reminders and task updates will notify you once the scheduler ships in Phase 3. Jarvis doesn't request notification permission until then.</p>
          </>
        )}

        {section === 'connections' && (
          <>
            <h2>Connections</h2>
            <p className="status-line">
              <span className="dot dot-off" /> No accounts connected.
            </p>
            <p>
              Jarvis only connects to services you approve, one at a time, starting with GitHub in Phase 3. Each
              connection will show what it can access, a history of what Jarvis did with it, and a button to revoke it.
            </p>
          </>
        )}

        {section === 'about' && (
          <>
            <h2>About</h2>
            {info ? (
              <dl className="about">
                <div><dt>Version</dt><dd>{info.version}</dd></div>
                <div><dt>System</dt><dd>{PLATFORM[info.platform] ?? info.platform}, {info.arch}</dd></div>
                <div><dt>Electron</dt><dd>{info.versions.electron}</dd></div>
                <div><dt>Chromium</dt><dd>{info.versions.chrome}</dd></div>
                <div><dt>Node.js</dt><dd>{info.versions.node}</dd></div>
                <div><dt>Build</dt><dd>{info.isPackaged ? 'Packaged app' : 'Development'}</dd></div>
              </dl>
            ) : (
              <p>Reading system details…</p>
            )}
            <p className="fine">Emergency stop: ⌘⇧. from anywhere in Jarvis.</p>
          </>
        )}
      </div>
    </div>
  )
}
