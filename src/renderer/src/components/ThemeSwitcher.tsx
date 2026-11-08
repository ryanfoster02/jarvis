import { THEMES, type Theme } from '../../../shared/ipc.ts'

export const THEME_NAMES: Record<Theme, string> = { gold: 'Gold', azure: 'Azure blue', cyan: 'Cyan' }

export function ThemeSwitcher({
  value,
  onChange,
  showNames = false,
}: {
  value: Theme
  onChange: (t: Theme) => void
  showNames?: boolean
}): React.JSX.Element {
  return (
    <div className={`theme-switch ${showNames ? 'with-names' : ''}`} role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={value === t}
          className={`swatch-btn ${value === t ? 'is-active' : ''}`}
          onClick={() => onChange(t)}
          title={THEME_NAMES[t]}
        >
          <span className={`swatch swatch-${t}`} />
          {showNames ? <span>{THEME_NAMES[t]}</span> : <span className="sr-only">{THEME_NAMES[t]}</span>}
        </button>
      ))}
    </div>
  )
}
