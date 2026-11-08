export type CoreState = 'idle' | 'listening' | 'processing' | 'speaking' | 'executing' | 'error'

const LABELS: Record<CoreState, string> = {
  idle: 'Standing by',
  listening: 'Listening',
  processing: 'Processing',
  speaking: 'Speaking',
  executing: 'Executing',
  error: 'Halted',
}

/** Sprint 1 core: CSS-only rings driven by state. The full animated core lands in Sprint 2. */
export function AiCore({ state }: { state: CoreState }): React.JSX.Element {
  return (
    <div className="core" data-state={state} role="status" aria-live="polite">
      <div className="core-stage">
        <span className="ring ring-1" />
        <span className="ring ring-2" />
        <span className="ring ring-3" />
        <span className="core-nucleus" />
      </div>
      <div className="core-label">
        <span className="core-dot" />
        {LABELS[state]}
      </div>
    </div>
  )
}
