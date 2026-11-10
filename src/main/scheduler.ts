import { BrowserWindow, Notification } from 'electron'
import { Events, WORKSPACES, type Reminder } from '../shared/ipc.ts'
import { sweepOnStartup, TICK_MS } from '../shared/reminders.ts'
import type { Db } from './db/conversations.ts'
import { markFired, markMissed, pendingDue } from './db/reminders.ts'
import { isHalted } from './killswitch.ts'
import { loadSettings } from './settings.ts'

// Reminder scheduler (Sprint 10). Runs only while the app is running — there is no background agent,
// launch item or OS-level schedule, and the UI says so. Checks every TICK_MS. While Stop all is
// engaged nothing fires; overdue reminders fire after re-arm. Reminders that came due while the app
// was closed are marked missed at the next launch (one summary notification, not a burst).

let db: Db | null = null
let timer: ReturnType<typeof setInterval> | null = null
let busy = false
// Electron notifications must stay referenced until shown/clicked, or macOS may drop their handlers.
const live = new Set<Notification>()

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export const remindersChanged = (): void => broadcast(Events.remindersChanged)

function focusApp(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function notify(title: string, body: string): void {
  if (!loadSettings().reminderNotifications || !Notification.isSupported()) return
  const n = new Notification({ title, body })
  live.add(n)
  const release = (): void => {
    live.delete(n)
  }
  n.on('click', () => {
    focusApp()
    release()
  })
  n.on('close', release)
  n.on('failed', release)
  n.show()
  // Don't hold references forever if the OS never reports back.
  setTimeout(release, 10 * 60_000)
}

async function fire(list: Reminder[]): Promise<void> {
  if (!db || list.length === 0) return
  const at = Date.now()
  await markFired(
    db,
    list.map((r) => r.id),
    at,
  )
  for (const r of list) {
    const fired: Reminder = { ...r, status: 'fired', firedAt: at }
    broadcast(Events.reminderFired, fired)
    const ws = WORKSPACES.find((w) => w.id === r.workspaceId)?.name ?? ''
    notify(ws ? `Reminder · ${ws}` : 'Reminder', r.text)
  }
  remindersChanged()
}

async function tick(): Promise<void> {
  if (!db || busy || isHalted()) return
  busy = true
  try {
    await fire(await pendingDue(db, Date.now()))
  } catch (err) {
    console.error('[scheduler] tick failed:', err)
  } finally {
    busy = false
  }
}

export async function startScheduler(database: Db): Promise<void> {
  db = database
  try {
    const now = Date.now()
    const { fire: dueNow, missed } = sweepOnStartup(await pendingDue(database, now), now)
    if (missed.length) {
      await markMissed(
        database,
        missed.map((r) => r.id),
      )
      notify('JARVIS', missed.length === 1 ? '1 reminder came due while JARVIS was closed.' : `${missed.length} reminders came due while JARVIS was closed.`)
      remindersChanged()
    }
    await fire(dueNow)
  } catch (err) {
    console.error('[scheduler] startup sweep failed:', err)
  }
  timer ??= setInterval(() => void tick(), TICK_MS)
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
  db = null
  live.clear()
}
