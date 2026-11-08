interface Props {
  line: string
  tone: 'normal' | 'halted'
}

/** Status line + telemetry. Values are real: nothing is metered until a provider is connected. */
export function StatusTerminal({ line, tone }: Props): React.JSX.Element {
  return (
    <section className={`frame terminal ${tone === 'halted' ? 'is-halted' : ''}`} aria-label="Status">
      <p className="terminal-line" role="status" aria-live="polite">
        <span aria-hidden="true">›</span> {line}
        <span className="cursor" aria-hidden="true" />
      </p>
      <dl className="telemetry">
        <div>
          <dt>Provider</dt>
          <dd>None</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>0</dd>
        </div>
        <div>
          <dt>Cost est.</dt>
          <dd>$0.000</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>—</dd>
        </div>
      </dl>
    </section>
  )
}
