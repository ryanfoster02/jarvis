import { CORE_LABELS, CORE_STATES, type CoreState } from './AiCore.tsx'

// What each state means today. Honest about which ones can't happen yet.
const WHEN: Record<CoreState, string> = {
  idle: 'ready for you',
  listening: 'arrives with voice',
  processing: 'while a message is sent',
  executing: 'with agent runtime',
  speaking: 'arrives with voice',
  'needs-you': 'when an approval waits',
  error: 'after stop all',
}

export function StateLegend({ current }: { current: CoreState }): React.JSX.Element {
  return (
    <section className="frame panel legend" aria-label="Jarvis states">
      <h2 className="label">Presence</h2>
      <ul>
        {CORE_STATES.map((s) => (
          <li key={s} data-state={s} className={s === current ? 'is-current' : undefined} aria-current={s === current ? 'true' : undefined}>
            <span className="legend-dot" data-state={s} />
            <span className="legend-name">{CORE_LABELS[s]}</span>
            <span className="legend-when">{WHEN[s]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
