import { THEMES, type Theme } from '../../../shared/ipc.ts'

const NAMES: Record<Theme, string> = { gold: 'Gold', azure: 'Azure', cyan: 'Cyan' }

export function ThemeSwitcher({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }): React.JSX.Element {
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={value === t}
          className={`swatch swatch-${t} ${value === t ? 'is-active' : ''}`}
          onClick={() => onChange(t)}
          title={NAMES[t]}
        >
          <span className="sr-only">{NAMES[t]}</span>
        </button>
      ))}
    </div>
  )
}
