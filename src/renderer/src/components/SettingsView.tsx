import { TOOLS } from '../../../shared/tools.ts'
import { PLATFORM, PT } from '../platform.ts'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ELEVEN_MODELS,
  ELEVEN_PRESET,
  ELEVEN_VOICES,
  HONORIFICS,
  isElevenVoiceId,
  JARVIS_PRESET,
  PROVIDER_ENV,
  SPEECH_ENGINES,
  TEXT_MODELS,
  MAX_GITHUB_REPOS,
  type BackgroundStatus,
  type WebhookInfo,
  TEXT_PROVIDER_NAMES,
  TEXT_PROVIDERS,
  textModelProvider,
  PERSONAS,
  REALTIME_MODELS,
  VOICES,
  type AppInfo,
  type CredentialStatus,
  type ElevenModelId,
  type HonorificId,
  type ProviderId,
  type SpeechEngineId,
  type TextModelId,
  type PersonaId,
  type RealtimeModelId,
  type Settings,
  type VoiceId,
} from '../../../shared/ipc.ts'
import { SpeechQueue } from '../voice/speechQueue.ts'
import { AiCore, CORE_LABELS, CORE_STATES, type CoreState } from './AiCore.tsx'
import { ThemeSwitcher } from './ThemeSwitcher.tsx'
import { formatMB, formatMs, type PerfSnapshot } from '../../../shared/perf.ts'
import { BackupsPanel } from './BackupsPanel.tsx'
import { GooglePanel } from './GooglePanel.tsx'
import { N8nPanel } from './N8nPanel.tsx'
import type { UpdateCheckResult } from '../../../shared/updates.ts'

export type SettingsSection = Section
type Section = 'appearance' | 'voice' | 'provider' | 'permissions' | 'notifications' | 'connections' | 'data' | 'about'

const SECTIONS: Array<[Section, string]> = [
  ['appearance', 'Appearance'],
  ['voice', 'Voice'],
  ['provider', 'AI provider'],
  ['permissions', 'Permissions'],
  ['notifications', 'Notifications'],
  ['connections', 'Connections'],
  ['data', 'Data'],
  ['about', 'About'],
]

const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

interface Props {
  settings: Settings
  info: AppInfo | null
  creds: CredentialStatus
  onCreds: (c: CredentialStatus) => void
  onUpdate: (patch: Partial<Settings>) => void
  /** Section to open (the setup guide links straight to one). */
  initialSection?: SettingsSection
}

const cap = (v: string): string => v.charAt(0).toUpperCase() + v.slice(1)
const voiceLabel = (v: VoiceId): string => (v === 'ballad' ? 'Ballad (closest to British)' : cap(v))

const PROVIDER_INFO: Record<ProviderId, { name: string; purpose: string; where: string; noun?: 'key' | 'token'; placeholder?: string }> = {
  github: {
    name: 'GitHub',
    noun: 'token',
    placeholder: 'github_pat_…',
    purpose: 'Read-only: lets Jarvis read issues, pull requests, commits and files in the repositories you allow below.',
    where:
      'github.com → Settings → Developer settings → Fine-grained tokens. Choose "Only select repositories" and give Contents, Issues and Pull requests read-only access (Metadata is added automatically)',
  },
  openai: {
    name: 'OpenAI',
    purpose: 'Listens and thinks: speech recognition and replies for voice.',
    where: 'platform.openai.com → API keys',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    purpose: 'Optional: answers typed messages when a Claude model is picked under Typed replies. Voice still needs the first key.',
    where: 'platform.claude.com → Settings → API keys',
  },
  elevenlabs: {
    name: 'ElevenLabs',
    purpose: "Speaks: Jarvis's British voice when the speech engine is ElevenLabs.",
    where: 'elevenlabs.io → Developers → API keys (needs the Text to Speech permission)',
  },
}

function KeyForm({
  provider,
  creds,
  onCreds,
}: {
  provider: ProviderId
  creds: CredentialStatus
  onCreds: (c: CredentialStatus) => void
}): React.JSX.Element {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const o = creds[provider]
  const info = PROVIDER_INFO[provider]
  const noun = info.noun ?? 'key'
  const Noun = noun === 'token' ? 'Token' : 'Key'

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!key.trim() || saving) return
    setSaving(true)
    setMessage(null)
    const res = await window.jarvis.credentials.set(provider, key)
    setSaving(false)
    if (res.ok) {
      setKey('')
      onCreds(res.status)
      setMessage({ tone: 'ok', text: `${Noun} verified with ${info.name} and saved to your keychain-protected vault.` })
    } else {
      setMessage({ tone: 'error', text: res.message })
    }
  }

  const remove = async (): Promise<void> => {
    onCreds(await window.jarvis.credentials.clear(provider))
    setMessage({
      tone: 'ok',
      text:
        provider === 'github'
          ? `Token removed from ${PT.computer}. To revoke it completely, delete it on github.com too.`
          : `Key removed from ${PT.computer}.`,
    })
  }

  return (
    <div className="provider">
      <h3>{info.name}</h3>
      <p className="fine">{info.purpose}</p>
      <p className="status-line">
        <span className={`dot ${o.configured ? 'dot-on' : 'dot-off'}`} />
        {!o.configured
          ? 'Not connected.'
          : o.source === 'env'
            ? `${Noun} from .env file · ending ${o.last4 ?? '????'}`
            : `Connected · ${noun} ending ${o.last4 ?? '????'}${o.verifiedAt ? ` · verified ${new Date(o.verifiedAt).toLocaleDateString()}` : ''}`}
      </p>
      {o.source === 'env' && (
        <p className="form-msg is-ok">
          Using {PROVIDER_ENV[provider]} from the project&apos;s .env file (development only).
          {o.vaultOverridden ? ` It overrides the saved ${noun}; remove it from .env to use the saved ${noun}.` : ''}
        </p>
      )}
      {o.envError && <p className="form-msg is-error">{o.envError}</p>}
      <form className="key-form" onSubmit={save}>
        <label>
          <span className="field-label">{o.source === 'vault' ? `Replace saved ${noun}` : `Save a ${noun} in the vault`}</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={info.placeholder ?? (provider === 'openai' ? 'sk-…' : provider === 'anthropic' ? 'sk-ant-…' : 'sk_…')}
            autoComplete="off"
            spellCheck={false}
            disabled={!creds.encryptionAvailable || saving}
          />
        </label>
        <button type="submit" className="btn" disabled={!key.trim() || saving || !creds.encryptionAvailable}>
          {saving ? 'Verifying…' : 'Verify and save'}
        </button>
        {(o.source === 'vault' || o.vaultOverridden) && (
          <button type="button" className="btn btn-quiet" onClick={() => void remove()}>
            Remove {noun}
          </button>
        )}
      </form>
      {message && <p className={`form-msg ${message.tone === 'error' ? 'is-error' : 'is-ok'}`}>{message.text}</p>}
      <p className="fine">
        Get a {noun} at {info.where}. Or, for development, put {PROVIDER_ENV[provider]} in .env (npm run setup:env).
      </p>
    </div>
  )
}

function BackgroundSettings({ settings, onUpdate }: { settings: Settings; onUpdate: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [status, setStatus] = useState<BackgroundStatus | null>(null)
  useEffect(() => {
    let live = true
    // Re-read shortly after a change: the OS applies login-item changes asynchronously.
    const read = (): void => void window.jarvis.background.status().then((s) => live && setStatus(s))
    read()
    const t = setTimeout(read, 800)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [settings.runInBackground, settings.openAtLogin])

  const loginNote = !status
    ? ''
    : !status.loginItemSupported
      ? 'Available in the installed app, not in development.'
      : !settings.runInBackground
        ? `Turn on ${PT.tray} mode first.`
        : !settings.openAtLogin
          ? 'Off.'
          : status.loginItemStatus === 'requires-approval'
            ? `macOS needs your approval: ${PT.loginItemsHelp} → allow JARVIS.`
            : status.openAtLogin
              ? `On: JARVIS starts in the ${PT.tray} when you log in.`
              : PLATFORM === 'mac'
                ? `macOS didn't register it. Ad-hoc signed builds may not be allowed to open at login; you can add JARVIS manually in ${PT.loginItemsHelp}.`
                : `It didn't register. You can add JARVIS manually in ${PT.loginItemsHelp}.`

  return (
    <>
      <h3 className="subhead">Background</h3>
      <div className="field">
        <div className="field-text">
          <h3>Keep running in the {PT.tray}</h3>
          <p>
            Closing the window leaves JARVIS in the {PT.tray} so reminders and routines still run. Voice and the microphone
            always stop when the window closes. {PT.quit} to stop everything.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={settings.runInBackground}
          aria-label={`Keep running in the ${PT.tray}`}
          className="switch"
          onClick={() => onUpdate({ runInBackground: !settings.runInBackground })}
        />
      </div>
      <div className="field">
        <div className="field-text">
          <h3>Open at login</h3>
          <p>{loginNote}</p>
        </div>
        <button
          role="switch"
          aria-checked={settings.openAtLogin}
          aria-label="Open at login"
          className="switch"
          disabled={!settings.runInBackground || !status?.loginItemSupported}
          onClick={() => onUpdate({ openAtLogin: !settings.openAtLogin })}
        />
      </div>
      {status && (
        <p className="status-line">
          <span className={`dot ${status.trayActive ? 'dot-on' : 'dot-off'}`} />
          {status.trayActive ? `The ${PT.trayIcon} is showing.` : 'Background mode is off.'}
        </p>
      )}
    </>
  )
}

/** Update check (Sprint 18): JARVIS says when a newer release exists and opens its page; it never installs anything. */
function UpdatesPanel({ settings, onUpdate }: { settings: Settings; onUpdate: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const check = async (): Promise<void> => {
    setChecking(true)
    setResult(await window.jarvis.updates.check())
    setChecking(false)
  }
  return (
    <div className="updates" aria-label="Updates">
      <h3 className="subhead">Updates</h3>
      <div className="backup-actions">
        <button className="btn" disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {result?.ok && result.newer && (
          <button className="btn btn-quiet" onClick={() => void window.jarvis.updates.openRelease()}>
            Open download page
          </button>
        )}
      </div>
      {result &&
        (result.ok ? (
          <p className="form-msg is-ok">
            {!result.latest
              ? 'No releases are published yet.'
              : result.newer
                ? `JARVIS ${result.latest.version} is available${result.latest.publishedAt ? ` (released ${new Date(result.latest.publishedAt).toLocaleDateString()})` : ''}. You have ${result.current}.`
                : `You have the latest version (${result.current}).`}
          </p>
        ) : (
          <p className="form-msg is-error">{result.message}</p>
        ))}
      <div className="field">
        <div className="field-text">
          <h3>Check automatically once a day</h3>
          <p>
            Asks GitHub for the latest JARVIS release and notifies you if there's a newer one. Nothing about you is sent, and
            nothing is downloaded or installed: you download the new version yourself.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={settings.checkForUpdates}
          aria-label="Check automatically once a day"
          className="switch"
          onClick={() => onUpdate({ checkForUpdates: !settings.checkForUpdates })}
        />
      </div>
    </div>
  )
}

/** Measured startup timeline and resource use (Sprint 16). Every number comes from the running app. */
function PerformancePanel(): React.JSX.Element {
  const [snap, setSnap] = useState<PerfSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const read = (): void => {
    window.jarvis.perf
      .get()
      .then((s) => {
        setSnap(s)
        setError(null)
      })
      .catch((err: unknown) => setError(`Couldn't read performance: ${String(err)}`))
  }
  useEffect(read, [])
  return (
    <div className="perf" aria-label="Performance">
      <h3 className="subhead">Performance</h3>
      {error && <p className="form-msg is-error">{error}</p>}
      {!snap ? (
        !error && <p>Measuring…</p>
      ) : (
        <>
          <h4 className="perf-head">Startup</h4>
          {snap.startup.length === 0 ? (
            <p className="fine">No startup timings recorded.</p>
          ) : (
            <dl className="about perf-startup">
              {snap.startup.map((r) => (
                <div key={r.mark}>
                  <dt>{r.label}</dt>
                  <dd>
                    {formatMs(r.atMs)} <span className="perf-step">+{formatMs(r.stepMs)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <h4 className="perf-head">Right now</h4>
          <dl className="about perf-usage">
            {snap.processes.map((p) => (
              <div key={p.label}>
                <dt>
                  {p.label}
                  {p.count > 1 ? ` (${p.count})` : ''}
                </dt>
                <dd>
                  {formatMB(p.memoryMB)} · {p.cpuPercent.toFixed(1)}% CPU
                </dd>
              </div>
            ))}
            <div>
              <dt>Total</dt>
              <dd>
                {formatMB(snap.totalMemoryMB)} · {snap.totalCpuPercent.toFixed(1)}% CPU
              </dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{snap.databaseMB === null ? 'not available' : formatMB(snap.databaseMB)}</dd>
            </div>
          </dl>
          <p className="fine">
            CPU is the share of one core over the last {snap.cpuWindowSec.toFixed(1)} s (100% = one core busy). Memory
            is what each part of Jarvis holds in RAM. Idle animation pauses while Jarvis is in the background.
          </p>
          <button className="btn" onClick={read}>
            Measure again
          </button>
        </>
      )}
    </div>
  )
}

function WebhooksPanel({ encryptionAvailable }: { encryptionAvailable: boolean }): React.JSX.Element {
  const [list, setList] = useState<WebhookInfo[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = (): void => void window.jarvis.webhooks.list().then(setList)
  useEffect(load, [])

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const r = await window.jarvis.webhooks.add({ name, url, secret: secret || null })
    if (r.ok) {
      setName('')
      setUrl('')
      setSecret('')
      setMsg({ tone: 'ok', text: `Added ${r.value.name} (${r.value.host}). Try “Test” to check it.` })
      load()
    } else setMsg({ tone: 'error', text: r.message })
  }
  const test = async (w: WebhookInfo): Promise<void> => {
    setBusy(w.id)
    const r = await window.jarvis.webhooks.test(w.id)
    setBusy(null)
    setMsg(r.ok ? { tone: 'ok', text: `${w.name} answered ${r.status}.` } : { tone: 'error', text: `${w.name}: ${r.message}` })
    load()
  }
  const remove = async (w: WebhookInfo): Promise<void> => {
    await window.jarvis.webhooks.delete(w.id)
    setMsg({ tone: 'ok', text: `Removed ${w.name}.` })
    load()
  }

  return (
    <div className="repo-allowlist" aria-label="Webhooks">
      <h3>Webhooks (n8n, Zapier, Make, CRMs)</h3>
      <p className="fine">
        Jarvis can send a message and data to these — e.g. an n8n workflow that adds a lead to your CRM or posts to Slack.
        Every send asks for your approval and shows exactly what goes out; scheduled routines can never send. Addresses are
        encrypted on {PT.computer} and only the host is shown here.
      </p>
      {list.length === 0 ? (
        <p className="empty-note">No webhooks yet.</p>
      ) : (
        <ul className="repos">
          {list.map((w) => (
            <li key={w.id}>
              <span className="repo-name">
                {w.name} · {w.host}
                {w.hasSecret ? ' · secret' : ''}
              </span>
              <span className="memory-actions">
                <button type="button" className="btn btn-quiet" disabled={busy === w.id} onClick={() => void test(w)}>
                  {busy === w.id ? 'Testing…' : 'Test'}
                </button>
                <button type="button" className="btn btn-quiet" aria-label={`Remove ${w.name}`} onClick={() => void remove(w)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="webhook-form" onSubmit={(e) => void add(e)} aria-label="Add webhook">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. CRM" aria-label="Webhook name" maxLength={40} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (or http://localhost:5678/… for a local n8n)"
          aria-label="Webhook URL"
          autoComplete="off"
          spellCheck={false}
        />
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Optional secret (sent as X-JARVIS-Secret)"
          aria-label="Webhook secret"
          type="password"
          autoComplete="off"
        />
        <button type="submit" className="btn" disabled={!name.trim() || !url.trim() || !encryptionAvailable}>
          Add webhook
        </button>
      </form>
      {msg && <p className={`form-msg ${msg.tone === 'error' ? 'is-error' : 'is-ok'}`}>{msg.text}</p>}
    </div>
  )
}

function GitHubConnection({
  settings,
  creds,
  onCreds,
  onUpdate,
}: {
  settings: Settings
  creds: CredentialStatus
  onCreds: (c: CredentialStatus) => void
  onUpdate: (patch: Partial<Settings>) => void
}): React.JSX.Element {
  const [repo, setRepo] = useState('')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const connected = creds.github.configured
  const full = settings.githubRepos.length >= MAX_GITHUB_REPOS

  const allow = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!repo.trim() || checking) return
    setChecking(true)
    setMessage(null)
    const r = await window.jarvis.github.checkRepo(repo)
    setChecking(false)
    if (!r.ok) {
      setMessage({ tone: 'error', text: r.message })
      return
    }
    const name = r.repo.fullName.toLowerCase()
    if (settings.githubRepos.includes(name)) {
      setMessage({ tone: 'ok', text: `${r.repo.fullName} is already allowed.` })
    } else {
      onUpdate({ githubRepos: [...settings.githubRepos, name] })
      setMessage({ tone: 'ok', text: `Allowed ${r.repo.fullName} (${r.repo.private ? 'private' : 'public'}). Jarvis can now read it.` })
    }
    setRepo('')
  }

  return (
    <>
      <KeyForm provider="github" creds={creds} onCreds={onCreds} />
      <div className="repo-allowlist" aria-label="Allowed repositories">
        <h3>Allowed repositories</h3>
        <p className="fine">
          Jarvis can read only these, and only to answer you: issues, pull requests, commits and files. It can&apos;t
          comment, change, merge or push. What it reads from GitHub is treated as untrusted text, never as instructions.
        </p>
        {settings.githubRepos.length === 0 ? (
          <p className="empty-note">{connected ? 'None yet. Add one below.' : 'Connect GitHub above, then add repositories here.'}</p>
        ) : (
          <ul className="repos">
            {settings.githubRepos.map((r) => (
              <li key={r}>
                <span className="repo-name">{r}</span>
                <button
                  type="button"
                  className="btn btn-quiet"
                  aria-label={`Remove ${r}`}
                  onClick={() => onUpdate({ githubRepos: settings.githubRepos.filter((x) => x !== r) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="key-form" onSubmit={allow}>
          <label>
            <span className="field-label">Repository</span>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/name or a github.com link"
              autoComplete="off"
              spellCheck={false}
              disabled={!connected || checking || full}
            />
          </label>
          <button type="submit" className="btn" disabled={!connected || checking || full || !repo.trim()}>
            {checking ? 'Checking…' : 'Check and allow'}
          </button>
        </form>
        {full && <p className="fine">That&apos;s the maximum of {MAX_GITHUB_REPOS}. Remove one to add another.</p>}
        {message && <p className={`form-msg ${message.tone === 'error' ? 'is-error' : 'is-ok'}`}>{message.text}</p>}
      </div>
    </>
  )
}

function ProviderSection({ creds, onCreds }: { creds: CredentialStatus; onCreds: (c: CredentialStatus) => void }): React.JSX.Element {
  return (
    <>
      <h2>AI provider</h2>
      <p>
        Keys are checked with the provider, then encrypted with {PT.keychain}. They never leave the main
        process: the interface only ever sees the last four characters.
      </p>
      {!creds.encryptionAvailable && (
        <p className="form-msg is-error">
          Secure storage isn&apos;t available on this system, so keys can&apos;t be saved.
          {PLATFORM === 'linux' && ' Install and unlock a keyring (GNOME Keyring or KWallet), then restart JARVIS.'}
        </p>
      )}
      <KeyForm provider="openai" creds={creds} onCreds={onCreds} />
      <KeyForm provider="anthropic" creds={creds} onCreds={onCreds} />
      <KeyForm provider="elevenlabs" creds={creds} onCreds={onCreds} />
    </>
  )
}

function ElevenLabsVoice({
  settings,
  creds,
  onUpdate,
}: {
  settings: Settings
  creds: CredentialStatus
  onUpdate: (patch: Partial<Settings>) => void
}): React.JSX.Element {
  const preset = ELEVEN_VOICES.find((v) => v.id === settings.elevenVoiceId)
  const [custom, setCustom] = useState(preset ? '' : settings.elevenVoiceId)
  const presetActive = settings.elevenVoiceId === ELEVEN_PRESET.elevenVoiceId && settings.persona === ELEVEN_PRESET.persona
  return (
    <>
      <div className="preset">
        <div className="field-text">
          <h3>JARVIS preset</h3>
          <p>Eldrin, a crisp British baritone from ElevenLabs, with the British butler personality.</p>
        </div>
        <button className="btn" disabled={presetActive} onClick={() => onUpdate({ ...ELEVEN_PRESET })}>
          {presetActive ? 'Preset active' : 'Use JARVIS preset'}
        </button>
      </div>
      <div className="field">
        <div className="field-text">
          <h3>ElevenLabs voice</h3>
          <p>{preset ? preset.note : 'Custom voice from your ElevenLabs account.'}</p>
        </div>
        <select
          className="select"
          value={preset ? preset.id : 'custom'}
          onChange={(e) => {
            if (e.target.value !== 'custom') onUpdate({ elevenVoiceId: e.target.value })
          }}
        >
          {ELEVEN_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
          <option value="custom">Custom voice ID…</option>
        </select>
      </div>
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (isElevenVoiceId(custom.trim())) onUpdate({ elevenVoiceId: custom.trim() })
        }}
      >
        <label>
          <span className="field-label">Custom voice ID (from a voice in your ElevenLabs account)</span>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 6WwXjDDEMyNmFG95zycZ" spellCheck={false} />
        </label>
        <button type="submit" className="btn btn-quiet" disabled={!isElevenVoiceId(custom.trim())}>
          Use this voice
        </button>
      </form>
      <p className="fine">
        Library voices like Eldrin may need adding to My Voices in ElevenLabs first. George and Daniel are legacy voices
        that ElevenLabs retires on December 31, 2026 and only work on accounts created before March 2026.
      </p>
      <div className="field">
        <div className="field-text">
          <h3>ElevenLabs model</h3>
          <p>Both are built for real-time speech.</p>
        </div>
        <select
          className="select"
          value={settings.elevenModel}
          onChange={(e) => onUpdate({ elevenModel: e.target.value as ElevenModelId })}
        >
          {ELEVEN_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <div className="field-text">
          <h3>Talk over Jarvis (headphones)</h3>
          <p>
            Off: the mic pauses while Jarvis speaks so it doesn&apos;t hear itself through your speakers; use Interrupt
            to cut in. On: talk over Jarvis any time — best with headphones.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={settings.bargeIn}
          className="switch"
          onClick={() => onUpdate({ bargeIn: !settings.bargeIn })}
        >
          <span className="sr-only">Talk over Jarvis</span>
        </button>
      </div>
      <div className="field">
        <div className="field-text">
          <h3>Hear it</h3>
          <p>Plays a short line in the selected voice (uses a few ElevenLabs characters).</p>
        </div>
        <TestVoice disabled={!creds.elevenlabs.configured} />
      </div>
    </>
  )
}

const TEST_LINE = 'Good evening. All systems are running smoothly, and nothing needs your attention.'

function TestVoice({ disabled }: { disabled: boolean }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const q = useRef<SpeechQueue | null>(null)
  if (!q.current) {
    q.current = new SpeechQueue({
      onStart: () => setState('playing'),
      onIdle: () => setState('idle'),
      onError: (m) => {
        setErr(m)
        setState('idle')
      },
      onCharacters: () => undefined,
    })
  }
  return (
    <div className="test-voice">
      <button
        className="btn"
        disabled={disabled || state !== 'idle'}
        onClick={() => {
          setErr(null)
          setState('loading')
          q.current?.enqueue(TEST_LINE)
        }}
      >
        {state === 'loading' ? 'Generating…' : state === 'playing' ? 'Playing…' : 'Test voice'}
      </button>
      {state === 'playing' && (
        <button className="btn btn-quiet" onClick={() => q.current?.stop()}>
          Stop
        </button>
      )}
      {err && <p className="form-msg is-error">{err}</p>}
    </div>
  )
}

export function SettingsView({ settings, info, creds, onCreds, onUpdate, initialSection }: Props): React.JSX.Element {
  const [section, setSection] = useState<Section>(initialSection ?? 'appearance')
  const [preview, setPreview] = useState<CoreState>('idle')
  const voiceReady =
    creds.openai.configured && (settings.speechEngine === 'openai' || creds.elevenlabs.configured)
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
                <p>Changes the accent across Jarvis. Saved on {PT.computer}.</p>
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
              <span className={`dot ${voiceReady ? 'dot-on' : 'dot-off'}`} />
              {voiceReady
                ? 'Ready. Start voice from the Conversation panel.'
                : settings.speechEngine === 'elevenlabs' && creds.openai.configured
                  ? 'Needs an ElevenLabs key (AI provider).'
                  : 'Needs an OpenAI key (AI provider).'}
            </p>

            <div className="field">
              <div className="field-text">
                <h3>Speech engine</h3>
                <p>ElevenLabs gives Jarvis a real British voice. OpenAI&apos;s built-in voices are the fallback.</p>
              </div>
              <select
                className="select"
                value={settings.speechEngine}
                onChange={(e) => onUpdate({ speechEngine: e.target.value as SpeechEngineId })}
              >
                {SPEECH_ENGINES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>

            {settings.speechEngine === 'elevenlabs' ? (
              <ElevenLabsVoice settings={settings} creds={creds} onUpdate={onUpdate} />
            ) : (
              <>
                <div className="preset">
                  <div className="field-text">
                    <h3>JARVIS preset (OpenAI)</h3>
                    <p>Ballad voice with the British butler personality. The accent comes from instructions and can drift.</p>
                  </div>
                  <button
                    className="btn"
                    disabled={settings.voice === JARVIS_PRESET.voice && settings.persona === JARVIS_PRESET.persona}
                    onClick={() => onUpdate({ ...JARVIS_PRESET })}
                  >
                    {settings.voice === JARVIS_PRESET.voice && settings.persona === JARVIS_PRESET.persona ? 'Preset active' : 'Use JARVIS preset'}
                  </button>
                </div>
                <div className="field">
                  <div className="field-text">
                    <h3>OpenAI voice</h3>
                    <p>OpenAI has no official British voice; Ballad sounds closest.</p>
                  </div>
                  <select className="select" value={settings.voice} onChange={(e) => onUpdate({ voice: e.target.value as VoiceId })}>
                    {VOICES.map((v) => (
                      <option key={v} value={v}>
                        {voiceLabel(v)}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="field">
              <div className="field-text">
                <h3>Personality</h3>
                <p>How Jarvis words its replies (and, with OpenAI voices, its accent).</p>
              </div>
              <select className="select" value={settings.persona} onChange={(e) => onUpdate({ persona: e.target.value as PersonaId })}>
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="field-text">
                <h3>Form of address</h3>
                <p>What Jarvis calls you.</p>
              </div>
              <select className="select" value={settings.honorific} onChange={(e) => onUpdate({ honorific: e.target.value as HonorificId })}>
                {HONORIFICS.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="field-text">
                <h3>Conversation model (OpenAI)</h3>
                <p>Listens and thinks in both engines. The mini model costs less.</p>
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
                <h3>Typed replies model</h3>
                <p>
                  Answers what you type when voice is off. Same personality, memory and limits as voice.
                  {!creds[textModelProvider(settings.textModel)].configured && (
                    <span className="field-warn">
                      {' '}
                      No {TEXT_PROVIDER_NAMES[textModelProvider(settings.textModel)]} key is saved, so typed replies won&apos;t work
                      until you add one above.
                    </span>
                  )}
                </p>
              </div>
              <select
                className="select"
                aria-label="Typed replies model"
                value={settings.textModel}
                onChange={(e) => onUpdate({ textModel: e.target.value as TextModelId })}
              >
                {TEXT_PROVIDERS.map((p) => (
                  <optgroup key={p} label={`${TEXT_PROVIDER_NAMES[p]}${creds[p].configured ? '' : ' (no key)'}`}>
                    {TEXT_MODELS.filter((m) => m.provider === p).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="field-text">
                <h3>Read typed replies aloud</h3>
                <p>Speaks Jarvis&apos;s typed answers with the ElevenLabs voice when voice is off.</p>
              </div>
              <button
                role="switch"
                aria-checked={settings.speakTypedReplies}
                className="switch"
                onClick={() => onUpdate({ speakTypedReplies: !settings.speakTypedReplies })}
                disabled={settings.speechEngine !== 'elevenlabs'}
              >
                <span className="sr-only">Read typed replies aloud</span>
              </button>
            </div>
            <p className="fine">
              Changes apply the next time you start voice. The microphone is only on while voice is running, and the top
              bar shows MIC LIVE whenever it is. Stop all ends voice immediately. Jarvis can use only the tools in Settings →
              Permissions, and asks you before anything that isn&apos;t low risk. Email, calendars and files aren&apos;t
              connected yet.
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

            <h3 className="subhead">What Jarvis can do</h3>
            <p>Switched-off tools are never offered to Jarvis. Changes apply to the next typed message and the next voice session.</p>
            <ul className="tool-list">
              {Object.values(TOOLS).map((t) => {
                const on = !settings.disabledTools.includes(t.name)
                return (
                  <li key={t.name} className="field">
                    <div className="field-text">
                      <h3>
                        {t.title} <span className={`risk-badge risk-${t.risk}`}>{t.risk}</span>
                      </h3>
                      <p>{t.ownerDescription}</p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={on}
                      aria-label={t.title}
                      className="switch"
                      onClick={() =>
                        onUpdate({
                          disabledTools: on ? [...settings.disabledTools, t.name] : settings.disabledTools.filter((n) => n !== t.name),
                        })
                      }
                    />
                  </li>
                )
              })}
            </ul>

            <h3 className="subhead">Standing permissions</h3>
            <div className="field">
              <div className="field-text">
                <h3>Save memories without asking</h3>
                <p>
                  Jarvis saves facts you ask it to remember straight away instead of asking each time. Secrets are still refused,
                  and every save is in the Activity log. Deleting memories always asks.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={settings.autoSaveMemories}
                aria-label="Save memories without asking"
                className="switch"
                disabled={settings.disabledTools.includes('save_memory')}
                onClick={() => onUpdate({ autoSaveMemories: !settings.autoSaveMemories })}
              />
            </div>
            <div className="field">
              <div className="field-text">
                <h3>Set reminders without asking</h3>
                <p>
                  Jarvis sets reminders you ask for straight away. Cancelling a reminder still asks, and after Jarvis has read
                  GitHub content in a task, it asks again.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={settings.autoSetReminders}
                aria-label="Set reminders without asking"
                className="switch"
                disabled={settings.disabledTools.includes('set_reminder')}
                onClick={() => onUpdate({ autoSetReminders: !settings.autoSetReminders })}
              />
            </div>
            <div className="field">
              <div className="field-text">
                <h3>Search the web without asking</h3>
                <p>
                  Each search costs about 1¢ plus tokens and still counts against the spend limit per task. After Jarvis has read
                  web or GitHub content in a task, further searches ask again.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={settings.autoWebSearch}
                aria-label="Search the web without asking"
                className="switch"
                disabled={settings.disabledTools.includes('web_search')}
                onClick={() => onUpdate({ autoWebSearch: !settings.autoWebSearch })}
              />
            </div>
            <p className="fine">
              Order of precedence: Stop all, then scope, then these switches, then high-risk approval, then standing permissions. Jarvis
              can&apos;t change any of these settings itself, and unanswered approvals expire after two minutes.
            </p>
          </>
        )}

        {section === 'notifications' && (
          <>
            <h2>Notifications</h2>
            <div className="field">
              <div className="field-text">
                <h3>Notify me when reminders are due</h3>
                <p>
                  Shows a desktop notification. The dashboard always shows the reminder too, and reads it aloud if typed
                  replies are read aloud.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={settings.reminderNotifications}
                aria-label="Notify me when reminders are due"
                className="switch"
                onClick={() => onUpdate({ reminderNotifications: !settings.reminderNotifications })}
              />
            </div>
            <p className="fine">
              Reminders and routines run only while JARVIS is running: with the window open, or in the {PT.tray} if you turn that on below. {PT.notificationsHelp} Reminders that come due while JARVIS is closed show as missed when you next open it.
            </p>
            <BackgroundSettings settings={settings} onUpdate={onUpdate} />
          </>
        )}

        {section === 'connections' && (
          <>
            <h2>Connections</h2>
            <p>
              Jarvis only connects to services you set up here, one at a time. Each connection shows what it can reach;
              everything Jarvis reads is listed under Activity on the dashboard. Email and files aren&apos;t available
              yet.
            </p>
            <GitHubConnection settings={settings} creds={creds} onCreds={onCreds} onUpdate={onUpdate} />
            <GooglePanel />
            <N8nPanel />
            <WebhooksPanel encryptionAvailable={creds.encryptionAvailable} />
          </>
        )}

        {section === 'data' && (
          <>
            <h2>Data</h2>
            <BackupsPanel />
          </>
        )}

        {section === 'about' && (
          <>
            <h2>About</h2>
            {info ? (
              <dl className="about">
                <div><dt>Version</dt><dd>{info.version}</dd></div>
                <div><dt>System</dt><dd>{PLATFORM_NAMES[info.platform] ?? info.platform}, {info.arch}</dd></div>
                <div><dt>Electron</dt><dd>{info.versions.electron}</dd></div>
                <div><dt>Chromium</dt><dd>{info.versions.chrome}</dd></div>
                <div><dt>Node.js</dt><dd>{info.versions.node}</dd></div>
                <div><dt>Build</dt><dd>{info.isPackaged ? 'Packaged app' : 'Development'}</dd></div>
              </dl>
            ) : (
              <p>Reading system details…</p>
            )}
            <p className="fine">Emergency stop: {PT.shortcut('.', true)} from anywhere in Jarvis.</p>
            <UpdatesPanel settings={settings} onUpdate={onUpdate} />
            {settings.setupGuideDismissed && (
              <p>
                <button className="btn btn-quiet" onClick={() => onUpdate({ setupGuideDismissed: false })}>
                  Show the setup guide again
                </button>
              </p>
            )}
            <PerformancePanel />
          </>
        )}
      </div>
    </div>
  )
}
