import { app, Menu, nativeImage, Tray } from 'electron'
import type { BackgroundStatus, Reminder, Settings } from '../shared/ipc.ts'
import { formatWhen } from '../shared/reminders.ts'
import type { Db } from './db/conversations.ts'
import { nextPending } from './db/reminders.ts'
import { engage, isHalted, onKillSwitchChange, rearm } from './killswitch.ts'
import { onRemindersChanged } from './scheduler.ts'
import { loadSettings } from './settings.ts'
import { TRAY_ICON_1X, TRAY_ICON_2X, TRAY_ICON_COLOR_1X, TRAY_ICON_COLOR_2X } from './trayIcon.ts'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { showMainWindow } from './windows.ts'

// Background mode (Sprint 11, owner-approved 2026-11-09). Opt-in. When on, closing the window keeps
// this process alive behind a menu-bar icon so reminders keep firing. There is no separate helper
// process, launch agent or daemon: quitting JARVIS stops everything. Voice and the microphone live
// in the window's renderer, so they always end when the window closes.

let tray: Tray | null = null
let db: Db | null = null
let next: Reminder | null = null
let ticker: ReturnType<typeof setInterval> | null = null

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Launched by the login item (Windows/Linux pass this flag; macOS reports wasOpenedAtLogin instead). */
export const BACKGROUND_FLAG = '--background'

/** Installed app only: in development the login item would point at the Electron binary. */
export const loginItemSupported = (): boolean =>
  app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux')

// Linux has no OS API in Electron for login items: use the XDG autostart standard.
const autostartFile = (): string => join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'autostart', 'jarvis.desktop')

function setLinuxAutostart(on: boolean): void {
  const file = autostartFile()
  if (!on) {
    rmSync(file, { force: true })
    return
  }
  // AppImages run from a temporary mount: start the .AppImage file itself.
  const exec = process.env['APPIMAGE'] || process.execPath
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=JARVIS',
      'Comment=Start JARVIS in the system tray',
      `Exec="${exec.replace(/(["\\`$])/g, '\\$1')}" ${BACKGROUND_FLAG}`,
      'X-GNOME-Autostart-enabled=true',
      'Terminal=false',
      '',
    ].join('\n'),
    { mode: 0o644 },
  )
}

function icon(): Electron.NativeImage {
  const mac = process.platform === 'darwin'
  const img = nativeImage.createEmpty()
  img.addRepresentation({ scaleFactor: 1, buffer: Buffer.from(mac ? TRAY_ICON_1X : TRAY_ICON_COLOR_1X, 'base64') })
  img.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(mac ? TRAY_ICON_2X : TRAY_ICON_COLOR_2X, 'base64') })
  if (mac) img.setTemplateImage(true)
  return img
}

function refreshMenu(): void {
  if (!tray) return
  const halted = isHalted()
  const menu = Menu.buildFromTemplate([
    { label: 'JARVIS is running in the background', enabled: false },
    {
      label: next ? `Next reminder: ${formatWhen(next.dueAt, Date.now())} · ${clip(next.text, 40)}` : 'No upcoming reminders',
      enabled: false,
    },
    ...(halted ? [{ label: 'Stopped: nothing runs until you re-arm', enabled: false }] : []),
    { type: 'separator' },
    { label: 'Open JARVIS', click: () => showMainWindow() },
    halted ? { label: 'Re-arm', click: () => void rearm() } : { label: 'Stop all', click: () => void engage('Stop all (menu bar)') },
    { type: 'separator' },
    { label: 'Quit JARVIS', role: 'quit' },
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(halted ? 'JARVIS — stopped' : 'JARVIS')
}

async function refreshNext(): Promise<void> {
  try {
    next = db ? await nextPending(db) : null
  } catch (err) {
    console.error('[background] could not read reminders:', err)
  }
  refreshMenu()
}

/** Apply the owner's settings: show/hide the menu-bar icon and register/unregister the login item. */
export function applyBackground(s: Settings): void {
  if (s.runInBackground && !tray) {
    tray = new Tray(icon())
    // Windows/Linux: a left click opens the window; the menu is on right click.
    if (process.platform !== 'darwin') tray.on('click', () => showMainWindow())
    void refreshNext()
  } else if (!s.runInBackground && tray) {
    tray.destroy()
    tray = null
    if (process.platform === 'darwin') void app.dock?.show()
  }
  if (loginItemSupported()) {
    const on = s.runInBackground && s.openAtLogin
    try {
      if (process.platform === 'linux') setLinuxAutostart(on)
      else if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: on, args: [BACKGROUND_FLAG] })
      else app.setLoginItemSettings({ openAtLogin: on })
    } catch (err) {
      console.error('[background] could not change the login item:', err)
    }
  }
}

export function backgroundStatus(): BackgroundStatus {
  if (!loginItemSupported()) return { trayActive: !!tray, loginItemSupported: false, openAtLogin: null, loginItemStatus: null }
  if (process.platform === 'linux') {
    return { trayActive: !!tray, loginItemSupported: true, openAtLogin: existsSync(autostartFile()), loginItemStatus: null }
  }
  const li = (
    process.platform === 'win32' ? app.getLoginItemSettings({ args: [BACKGROUND_FLAG] }) : app.getLoginItemSettings()
  ) as Electron.LoginItemSettings & { status?: string }
  return { trayActive: !!tray, loginItemSupported: true, openAtLogin: li.openAtLogin, loginItemStatus: li.status ?? null }
}

/** Launched by the OS at login with background mode on → start in the menu bar, no window. */
export function shouldStartHidden(): boolean {
  const s = loadSettings()
  if (!s.runInBackground || !s.openAtLogin || !loginItemSupported()) return false
  if (process.platform !== 'darwin') return process.argv.includes(BACKGROUND_FLAG)
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin === true
  } catch {
    return false
  }
}

/** Window closed. Returns true if the app should keep running. */
export function onAllWindowsClosed(): boolean {
  if (!loadSettings().runInBackground) return process.platform === 'darwin' // macOS convention without background mode
  if (process.platform === 'darwin') app.dock?.hide()
  return true
}

/** After a restore (Sprint 18): read reminders from the reopened database. */
export function setBackgroundDatabase(database: Db | null): void {
  db = database
  void refreshNext()
}

export function initBackground(database: Db | null): void {
  db = database
  onRemindersChanged(() => void refreshNext())
  onKillSwitchChange(refreshMenu)
  ticker ??= setInterval(() => void refreshNext(), 60_000) // keeps "today 9:30 PM" wording current
  applyBackground(loadSettings())
}
