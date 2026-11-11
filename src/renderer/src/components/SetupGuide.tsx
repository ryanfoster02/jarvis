import { useEffect, useState } from 'react'
import type { CredentialStatus, Settings } from '../../../shared/ipc.ts'
import type { SettingsSection } from './SettingsView.tsx'

interface Step {
  id: string
  title: string
  detail: string
  done: boolean
  optional: boolean
  action?: { label: string; section: SettingsSection }
}

/**
 * First-run checklist (Sprint 18). Every tick comes from real state (saved keys, connections,
 * conversations), never from having clicked something. Hidden once dismissed; Settings → About
 * brings it back.
 */
export function SetupGuide({
  settings,
  creds,
  hasConversations,
  onOpenSettings,
  onDismiss,
}: {
  settings: Settings
  creds: CredentialStatus
  hasConversations: boolean
  onOpenSettings: (section: SettingsSection) => void
  onDismiss: () => void
}): React.JSX.Element {
  const [webhooks, setWebhooks] = useState(0)
  const [google, setGoogle] = useState(false)
  useEffect(() => {
    void window.jarvis.webhooks.list().then((l) => setWebhooks(l.length))
    void window.jarvis.google.status().then((g) => setGoogle(g.connected && !g.needsReconnect))
  }, [])

  const textKey = creds.openai.configured || creds.anthropic.configured
  const voiceReady = creds.openai.configured && (settings.speechEngine !== 'elevenlabs' || creds.elevenlabs.configured)
  const connected = (creds.github.configured && settings.githubRepos.length > 0) || webhooks > 0 || google
  const steps: Step[] = [
    {
      id: 'key',
      title: 'Add an AI key',
      detail: textKey ? 'Typed replies are ready.' : 'OpenAI or Anthropic. Keys stay encrypted on this computer.',
      done: textKey,
      optional: false,
      action: textKey ? undefined : { label: 'Open AI provider settings', section: 'provider' },
    },
    {
      id: 'try',
      title: 'Ask Jarvis something',
      detail: hasConversations ? 'You have conversations.' : 'Type “What can you do?” in the conversation panel.',
      done: hasConversations,
      optional: false,
    },
    {
      id: 'voice',
      title: 'Talk to Jarvis',
      detail: voiceReady ? 'Voice is ready: press Start voice.' : 'Voice needs an OpenAI key; ElevenLabs gives the British voice.',
      done: voiceReady,
      optional: true,
      action: voiceReady ? undefined : { label: 'Open voice settings', section: 'voice' },
    },
    {
      id: 'connect',
      title: 'Connect Google Calendar, GitHub or a webhook',
      detail: connected ? 'A connection is set up.' : 'Read your calendar or GitHub, or send to n8n, Zapier or Make.',
      done: connected,
      optional: true,
      action: connected ? undefined : { label: 'Open connections', section: 'connections' },
    },
  ]
  const required = steps.filter((s) => !s.optional)
  const allSet = required.every((s) => s.done)

  return (
    <section className="frame panel setup-guide" aria-label="Get started">
      <h2 className="label">Get started</h2>
      {allSet && <p className="setup-done">You're set up. The rest is optional.</p>}
      <ol className="setup-steps">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'is-done' : ''} aria-label={`${s.title}${s.done ? ' (done)' : ''}`}>
            <span className="setup-mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <div>
              <p className="setup-title">
                {s.title}
                {s.optional && <span className="setup-optional"> · optional</span>}
              </p>
              <p className="setup-detail">{s.detail}</p>
              {s.action && (
                <button className="vbtn" onClick={() => onOpenSettings(s.action!.section)}>
                  {s.action.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button className="btn btn-quiet setup-hide" onClick={onDismiss}>
        Hide guide
      </button>
    </section>
  )
}
