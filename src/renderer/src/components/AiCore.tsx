import { useId } from 'react'

export type CoreState = 'idle' | 'listening' | 'processing' | 'speaking' | 'executing' | 'error'

export const CORE_STATES: readonly CoreState[] = ['idle', 'listening', 'processing', 'speaking', 'executing', 'error']

export const CORE_LABELS: Record<CoreState, string> = {
  idle: 'Standing by',
  listening: 'Listening',
  processing: 'Thinking',
  speaking: 'Speaking',
  executing: 'Executing',
  error: 'Halted',
}

const C = 200 // viewBox centre
const TICKS = Array.from({ length: 120 }, (_, i) => i)
const BARS = Array.from({ length: 64 }, (_, i) => i)

/**
 * The JARVIS core: an SVG instrument whose motion signature encodes state.
 *  idle       slow bezel drift, nucleus breathing
 *  listening  voice bars rise around the inner ring
 *  processing arcs spin fast, orbiting tracer
 *  speaking   voice bars pulse outward, nucleus flares
 *  executing  attention-coloured progress sweep
 *  error      motion stops, danger colour, slow warning pulse
 */
export function AiCore({ state, size = 'large' }: { state: CoreState; size?: 'large' | 'small' }): React.JSX.Element {
  const gradientId = `nucleus-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}` // unique per instance so each core keeps its own colour
  return (
    <div className={`core core-${size}`} data-state={state}>
      <svg viewBox="0 0 400 400" className="core-svg" aria-hidden="true">
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="46%" r="50%">
            <stop offset="0%" style={{ stopColor: '#ffffff', stopOpacity: 0.95 }} />
            <stop offset="28%" style={{ stopColor: 'var(--core)', stopOpacity: 0.9 }} />
            <stop offset="62%" style={{ stopColor: 'var(--core)', stopOpacity: 0.18 }} />
            <stop offset="100%" style={{ stopColor: 'var(--core)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        {/* Bezel: 120 ticks, every 10th long */}
        <g className="core-bezel">
          {TICKS.map((i) => (
            <line
              key={i}
              x1={C}
              y1={i % 10 === 0 ? 6 : 12}
              x2={C}
              y2={i % 10 === 0 ? 24 : 19}
              className={i % 10 === 0 ? 'tick tick-major' : 'tick'}
              transform={`rotate(${i * 3} ${C} ${C})`}
            />
          ))}
        </g>

        {/* Arc ring */}
        <circle className="core-track" cx={C} cy={C} r={160} />
        <g className="core-arcs">
          <circle className="arc arc-a" cx={C} cy={C} r={160} pathLength={360} />
          <circle className="arc arc-b" cx={C} cy={C} r={160} pathLength={360} />
        </g>

        {/* Executing sweep */}
        <circle className="core-sweep" cx={C} cy={C} r={142} pathLength={100} />

        {/* Inner dashed ring + orbiting tracer */}
        <g className="core-inner">
          <circle className="inner-ring" cx={C} cy={C} r={124} />
          <circle className="tracer" cx={C} cy={C - 124} r={4} />
        </g>

        {/* Voice bars */}
        <g className="core-bars">
          {BARS.map((i) => (
            <g key={i} transform={`rotate(${i * (360 / BARS.length)} ${C} ${C})`}>
              <rect className="bar" x={C - 1.25} y={C - 112} width={2.5} height={18} rx={1.25} style={{ animationDelay: `${(i % 8) * -0.11 - (i % 3) * 0.07}s` }} />
            </g>
          ))}
        </g>

        {/* Nucleus */}
        <circle className="core-nucleus" cx={C} cy={C} r={84} fill={`url(#${gradientId})`} />
        <circle className="core-nucleus-rim" cx={C} cy={C} r={58} />
      </svg>
    </div>
  )
}
