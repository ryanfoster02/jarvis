// Per-platform wording and shortcuts for the UI (Sprint 14). Pure; unit-tested.

export type Platform = 'mac' | 'windows' | 'linux'

/** From navigator.platform / userAgent (renderer) or process.platform (main). */
export function detectPlatform(hint: string): Platform {
  if (/mac|darwin|iphone|ipad/i.test(hint)) return 'mac'
  if (/win/i.test(hint)) return 'windows'
  return 'linux'
}

export interface PlatformText {
  /** Shortcut label, e.g. "⌘⇧." or "Ctrl+Shift+." */
  shortcut: (key: string, shift?: boolean) => string
  computer: string
  keychain: string
  tray: string
  trayIcon: string
  quit: string
  notificationsHelp: string
  loginItemsHelp: string
}

const TEXT: Record<Platform, PlatformText> = {
  mac: {
    shortcut: (key, shift) => `⌘${shift ? '⇧' : ''}${key}`,
    computer: 'this Mac',
    keychain: "your Mac's keychain",
    tray: 'menu bar',
    trayIcon: 'menu-bar icon',
    quit: 'Quit from the menu-bar icon or with ⌘Q',
    notificationsHelp:
      'If notifications don’t appear, allow them in System Settings → Notifications (in development the app is listed as “Electron”).',
    loginItemsHelp: 'System Settings → General → Login Items',
  },
  windows: {
    shortcut: (key, shift) => `Ctrl+${shift ? 'Shift+' : ''}${key}`,
    computer: 'this PC',
    keychain: 'Windows data protection (DPAPI)',
    tray: 'system tray',
    trayIcon: 'tray icon',
    quit: 'Quit from the tray icon (right-click) or File → Exit',
    notificationsHelp: 'If notifications don’t appear, check Settings → System → Notifications, and that Do Not Disturb is off.',
    loginItemsHelp: 'Settings → Apps → Startup',
  },
  linux: {
    shortcut: (key, shift) => `Ctrl+${shift ? 'Shift+' : ''}${key}`,
    computer: 'this computer',
    keychain: 'your desktop keyring (GNOME Keyring or KWallet)',
    tray: 'system tray',
    trayIcon: 'tray icon',
    quit: 'Quit from the tray icon or File → Quit',
    notificationsHelp: 'If notifications don’t appear, check your desktop’s notification settings.',
    loginItemsHelp: 'your desktop’s Startup Applications settings (JARVIS adds ~/.config/autostart/jarvis.desktop)',
  },
}

export const platformText = (p: Platform): PlatformText => TEXT[p]
