import { useState, type FormEvent } from 'react'
import { REALTIME_MODELS, VOICES, type AppInfo, type CredentialStatus, type RealtimeModelId, type Settings, type VoiceId } from '../../../shared/ipc.ts'
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
  creds: CredentialStatus
  onCreds: (c: CredentialStatus) => void
  onUpdate: (patch: Partial<Settings>) => void
}

const cap = (v: string): string => v.charAt(0).toUpperCase() + v.slice(1)

function ProviderSection({ creds, onCreds }: { creds: CredentialStatus; onCreds: (c: CredentialStatus) => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const o = creds.openai

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!key.trim() || saving) return
    setSaving(true)
    setMessage(null)
    const res = await window.jarvis.credentials.setOpenAIKey(key)
    setSaving(false)
    if (res.ok) {
      setKey('')
      onCreds(res.status)
      setMessage({ tone: 'ok', text: 'Key verified with OpenAI and saved to your keychain-protected vault.' })
    } else {
      setMessage({ tone: 'error', text: res.message })
    }
  }

  const remove = async (): Promise<void> => {
    onCreds(await window.jarvis.credentials.clearOpenAIKey())
    setMessage({ tone: 'ok', text: 'Key removed from this Mac.' })
  }

  return (
    <>
      <h2>AI provider</h2>
      <p className="status-line">
        <span className={`dot ${o.configured ? 'dot-on' : 'dot-off'}`} />
        {o.configured
          ? `OpenAI connected · key ending ${o.last4 ?? '????'}${o.verifiedAt ? ` · verified ${new Date(o.verifiedAt).toLocaleDateString()}` : ''}`
          : 'No provider connected.'}
      </p>
      <p>
        Jarvis uses your OpenAI API key for voice. The key is checked with OpenAI, then encrypted with your Mac's
        keychain. It never leaves the main process: the interface only ever sees its last four characters.
      </p>
      {!creds.encryptionAvailable && (
        <p className="form-msg is-error">Secure storage isn't available on this system, so keys can't be saved.</p>
      )}
      <form className="key-form" onSubmit={save}>
        <label>
          <span className="field-label">{o.configured ? 'Replace key' : 'OpenAI API key'}</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
            disabled={!creds.encryptionAvailable || saving}
          />
        </label>
        <button type="submit" className="btn" disabled={!key.trim() || saving || !creds.encryptionAvailable}>
          {saving ? 'Verifying…' : 'Verify and save'}
        </button>
        {o.configured && (
          <button type="button" className="btn btn-quiet" onClick={() => void remove()}>
            Remove key
          </button>
        )}
      </form>
      {message && <p className={`form-msg ${message.tone === 'error' ? 'is-error' : 'is-ok'}`}>{message.text}</p>}
      <p className="fine">Get a key at platform.openai.com → API keys. Voice usage is billed to that account.</p>
    </>
  )
}

export function SettingsView({ settings, info, creds, onCreds, onUpdate }: Props): React.JSX.Element {
  const [section, setSection] = useState<Section>('appearance')
  const [preview, setPreview] = useState<CoreState>('idle')
  const onTheme = (theme: Settings['theme']): void => onUpdate({ theme })
  const onReducedMotion = (reducedMotion: boolean): void => onUpdate({ reducedMotion })

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
              <span className={`dot ${creds.openai.configured ? 'dot-on' : 'dot-off'}`} />
              {creds.openai.configured ? 'Ready. Start voice from the Conversation panel.' : 'Needs an OpenAI key (AI provider).'}
            </p>
            <div className="field">
              <div className="field-text">
                <h3>Model</h3>
                <p>The mini model costs less and suits everyday conversation.</p>
              </div>
              <select
                className="select"
                value={settings.realtimeModel}
                onChange={(e) => onUpdate({ realtimeModel: e.target.value as RealtimeModelId })}
              >
                {REALTIME_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="field-text">
                <h3>Voice</h3>
                <p>OpenAI recommends Marin and Cedar. Changes apply the next time you start voice.</p>
              </div>
              <select className="select" value={settings.voice} onChange={(e) => onUpdate({ voice: e.target.value as VoiceId })}>
                {VOICES.map((v) => (
                  <option key={v} value={v}>
                    {cap(v)}
                  </option>
                ))}
              </select>
            </div>
            <p className="fine">
              The microphone is only on while voice is running, and the top bar shows MIC LIVE whenever it is. Stop all
              ends voice immediately. Jarvis can talk but can't take actions or read your data yet.
            </p>
          </>
        )}

        {section === 'provider' && <ProviderSection creds={creds} onCreds={onCreds} />}

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
