export interface Telemetry {
  provider: string
  tokens: number
  costUsd: number | null // null = no published price for this model
  latencyMs: number | null
  /** Characters sent to ElevenLabs this session (billed by ElevenLabs, separately). */
  ttsChars: number
}

interface Props {
  line: string
  tone: 'normal' | 'halted' | 'error'
  telemetry: Telemetry
}

/** Status line + session telemetry. Every value is measured from real responses; nothing is simulated. */
export function StatusTerminal({ line, tone, telemetry }: Props): React.JSX.Element {
  return (
    <section className={`frame terminal ${tone !== 'normal' ? 'is-halted' : ''}`} aria-label="Status">
      <p className="terminal-line" role="status" aria-live="polite">
        <span aria-hidden="true">›</span> {line}
        <span className="cursor" aria-hidden="true" />
      </p>
      <dl className="telemetry">
        <div>
          <dt>Provider</dt>
          <dd>{telemetry.provider}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{telemetry.tokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Cost est.</dt>
          <dd
            title={
              (telemetry.costUsd === null ? 'No published price for this OpenAI model.' : 'OpenAI cost estimated from token usage this session.') +
              (telemetry.ttsChars > 0 ? ` ElevenLabs: ${telemetry.ttsChars.toLocaleString()} characters, billed separately by ElevenLabs.` : '')
            }
          >
            {telemetry.costUsd === null ? '—' : `$${telemetry.costUsd.toFixed(3)}`}
          </dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd title="Time from the end of your turn to Jarvis's first reply">
            {telemetry.latencyMs === null ? '—' : `${telemetry.latencyMs} ms`}
          </dd>
        </div>
      </dl>
    </section>
  )
}
