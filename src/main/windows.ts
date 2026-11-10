import { app, BrowserWindow } from 'electron'

// One place that knows how to (re)open the main window, for the tray, notifications, a second
// launch, and the Dock. index.ts registers the factory at startup.

let factory: (() => BrowserWindow) | null = null

export function registerWindowFactory(f: () => BrowserWindow): void {
  factory = f
}

export function showMainWindow(): void {
  let win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win && factory) win = factory()
  if (!win) return
  if (process.platform === 'darwin') void app.dock?.show()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
