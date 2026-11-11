import { useEffect, useState } from 'react'
import type { CalendarEvent } from '../../../shared/google.ts'

const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Dashboard: today's Google Calendar events (Sprint 19). Shown only while Google is connected. */
export function TodayPanel(): React.JSX.Element | null {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const st = await window.jarvis.google.status()
      if (!alive) return
      setConnected(st.connected)
      if (!st.connected) return
      const r = await window.jarvis.calendar.events('today')
      if (!alive) return
      if (r.ok) {
        setEvents(r.events)
        setError(null)
      } else setError(r.message)
      setNow(Date.now())
    }
    void load()
    const timer = setInterval(() => void load(), 5 * 60_000)
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (!connected) return null
  const upcoming = events?.filter((e) => !e.declined) ?? []
  return (
    <section className="frame panel today" aria-label="Today">
      <h2 className="label">Today</h2>
      {error ? (
        <p className="form-msg is-error">{error}</p>
      ) : events === null ? (
        <p className="empty-note">Reading your calendar…</p>
      ) : upcoming.length === 0 ? (
        <p className="empty-note">Nothing on your calendar today.</p>
      ) : (
        <ul className="today-list">
          {upcoming.slice(0, 8).map((e) => (
            <li key={e.id} className={e.end < now ? 'is-past' : e.start <= now ? 'is-now' : ''}>
              <span className="today-time">{e.allDay ? 'All day' : time(e.start)}</span>
              <span className="today-title" title={`${e.title} (${e.calendar})`}>
                {e.title}
              </span>
              {e.meet && e.end >= now && (
                <a className="today-meet" href={e.meet} target="_blank" rel="noreferrer noopener">
                  Join
                </a>
              )}
            </li>
          ))}
          {upcoming.length > 8 && <li className="today-more">+{upcoming.length - 8} more</li>}
        </ul>
      )}
    </section>
  )
}
