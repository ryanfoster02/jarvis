import { useId } from 'react'

export type CoreState = 'idle' | 'listening' | 'processing' | 'speaking' | 'executing' | 'needs-you' | 'error'

export const CORE_STATES: readonly CoreState[] = [
  'idle',
  'listening',
  'processing',
  'executing',
  'speaking',
  'needs-you',
  'error',
]

export const CORE_LABELS: Record<CoreState, string> = {
  idle: 'Standing by',
  listening: 'Listening',
  processing: 'Thinking',
  speaking: 'Speaking',
  executing: 'Working',
  'needs-you': 'Needs you',
  error: 'Stopped',
}

const C = 200 // viewBox centre
const TICKS = Array.from({ length: 180 }, (_, i) => i)
const BARS = Array.from({ length: 72 }, (_, i) => i)

/** Equilateral triangle points on a circle of radius r, rotated by `deg`. */
const triangle = (r: number, deg: number): string =>
  [0, 120, 240]
    .map((a) => {
      const t = ((a + deg - 90) * Math.PI) / 180
      return `${(C + r * Math.cos(t)).toFixed(2)},${(C + r * Math.sin(t)).toFixed(2)}`
    })
    .join(' ')

/**
 * The JARVIS core: an SVG instrument whose motion signature encodes state.
 *  idle        slow breath, rings drift
 *  listening   level ring of bars rises
 *  processing  arcs orbit fast, tracer circles
 *  executing   progress sweep
 *  speaking    bars pulse as a waveform
 *  needs-you   attention colour, slow pulse
 *  error       all motion frozen, danger colour
 */
export function AiCore({
  state,
  size = 'large',
  showLabel = true,
}: {
  state: CoreState
  size?: 'large' | 'small'
  showLabel?: boolean
}): React.JSX.Element {
  const gradientId = `nucleus-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <div className={`core core-${size}`} data-state={state}>
      <svg viewBox="0 0 400 400" className="core-svg" aria-hidden="true">
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="45%" r="50%">
            <stop offset="0%" style={{ stopColor: '#fff6e0', stopOpacity: 0.95 }} />
            <stop offset="22%" style={{ stopColor: 'var(--core)', stopOpacity: 0.95 }} />
            <stop offset="60%" style={{ stopColor: 'var(--core)', stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: 'var(--core)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        {/* Dense bezel: 180 ticks, every 15th long */}
        <g className="core-bezel">
          {TICKS.map((i) => (
            <line
              key={i}
              x1={C}
              y1={i % 15 === 0 ? 2 : 6}
              x2={C}
              y2={i % 15 === 0 ? 22 : 16}
              className={i % 15 === 0 ? 'tick tick-major' : 'tick'}
              transform={`rotate(${i * 2} ${C} ${C})`}
            />
          ))}
        </g>

        {/* Segmented ring */}
        <circle className="core-segments" cx={C} cy={C} r={170} pathLength={360} />
        <circle className="core-hairline" cx={C} cy={C} r={154} />

        {/* Orbiting arcs */}
        <circle className="arc arc-a" cx={C} cy={C} r={140} pathLength={360} />
        <circle className="arc arc-b" cx={C} cy={C} r={140} pathLength={360} />

        {/* Working sweep */}
        <circle className="core-sweep" cx={C} cy={C} r={154} pathLength={100} />

        {/* Dotted ring + tracer */}
        <g className="core-inner">
          <circle className="inner-ring" cx={C} cy={C} r={110} />
          <circle className="tracer" cx={C} cy={C - 110} r={4} />
        </g>

        {/* Level / waveform bars */}
        <g className="core-bars">
          {BARS.map((i) => (
            <g key={i} transform={`rotate(${i * (360 / BARS.length)} ${C} ${C})`}>
              <rect
                className="bar"
                x={C - 1.1}
                y={C - 132}
                width={2.2}
                height={16}
                rx={1.1}
                style={{ animationDelay: `${(i % 9) * -0.09 - (i % 4) * 0.05}s` }}
              />
            </g>
          ))}
        </g>

        {/* Counter-rotating triangles */}
        <polygon className="tri tri-a" points={triangle(100, 0)} />
        <polygon className="tri tri-b" points={triangle(92, 60)} />

        {/* Nucleus */}
        <circle className="core-nucleus" cx={C} cy={C} r={92} fill={`url(#${gradientId})`} />
        <circle className="core-nucleus-rim" cx={C} cy={C} r={66} />

        {showLabel && (
          <>
            <text className="core-name" x={C} y={C + 4} textAnchor="middle">
              JARVIS
            </text>
            <text className="core-state" x={C} y={C + 24} textAnchor="middle">
              {CORE_LABELS[state].toUpperCase()}
            </text>
          </>
        )}
      </svg>
    </div>
  )
}
