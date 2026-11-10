// Reminder rules (Sprint 10). Pure; unit-tested. Times are epoch milliseconds; "local" means the
// computer's time zone (the main process interprets times the same way the owner reads them).

import { IpcValidationError, type Reminder } from './ipc.ts'
import { detectSecret } from './memory.ts'

export const MAX_REMINDER_CHARS = 300
export const MAX_PENDING_REMINDERS = 200
/** How far ahead a reminder can be set. */
export const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000
/** A reminder due within this much of startup still fires normally; older ones count as missed. */
export const STARTUP_GRACE_MS = 2 * 60 * 1000
/** Scheduler resolution. */
export const TICK_MS = 10_000
export const SNOOZE_MINUTES = [10, 60] as const

export function validateReminderText(input: unknown): string {
  if (typeof input !== 'string') throw new IpcValidationError('Reminder must be text.')
  const text = input.replace(/\s+/g, ' ').trim()
  if (!text) throw new IpcValidationError('Reminder is empty.')
  if (text.length > MAX_REMINDER_CHARS) throw new IpcValidationError(`Keep reminders under ${MAX_REMINDER_CHARS} characters.`)
  const secret = detectSecret(text)
  if (secret) throw new IpcValidationError(`That looks like it contains ${secret}. Reminders can't hold credentials.`)
  return text
}

/**
 * When a reminder is due. Accepts epoch ms, or an ISO date-time. Without an offset
 * ("2026-11-10T09:30") it is read as local time, which is how people (and the model) say it.
 * Must be in the future (up to a minute ago is rounded up to now) and within MAX_AHEAD_MS.
 */
export function parseWhen(input: unknown, now: number): number {
  let ms: number
  if (typeof input === 'number' && Number.isFinite(input)) {
    ms = Math.round(input)
  } else if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(input.trim())) {
    ms = new Date(input.trim()).getTime()
  } else {
    throw new IpcValidationError('Give the time as a date and time, like 2026-11-10T09:30.')
  }
  if (!Number.isFinite(ms)) throw new IpcValidationError("That date doesn't exist.")
  if (ms < now - 60_000) throw new IpcValidationError('That time has already passed.')
  if (ms > now + MAX_AHEAD_MS) throw new IpcValidationError('Reminders can be set up to a year ahead.')
  return Math.max(ms, now)
}

/** Pending reminders that are due now. */
export const dueReminders = (pending: readonly Reminder[], now: number): Reminder[] =>
  pending.filter((r) => r.status === 'pending' && r.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)

/**
 * At startup: anything that came due while JARVIS was closed. Recently due → fire now;
 * older → mark missed (shown in the app, one summary notification) rather than a burst of alerts.
 */
export function sweepOnStartup(pending: readonly Reminder[], now: number): { fire: Reminder[]; missed: Reminder[] } {
  const due = dueReminders(pending, now)
  return {
    fire: due.filter((r) => now - r.dueAt <= STARTUP_GRACE_MS),
    missed: due.filter((r) => now - r.dueAt > STARTUP_GRACE_MS),
  }
}

const startOfDay = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "today 9:30 PM", "tomorrow 8:00 AM", "Thu 12 Nov, 9:00 AM" — in the computer's locale and time zone. */
export function formatWhen(ms: number, now: number, locale?: string): string {
  const time = new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / 86_400_000)
  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  if (days === -1) return `yesterday ${time}`
  const date = new Date(ms).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(new Date(ms).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  })
  return `${date}, ${time}`
}

/** For the model: unambiguous local time with offset, e.g. "2026-11-10T09:30-06:00". */
export function localIso(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
}
