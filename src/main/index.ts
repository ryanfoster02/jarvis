import { app, BrowserWindow, Menu, session, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc, type HistoryStore } from './ipc.ts'
import { openDatabase } from './db/client.ts'
import { forgetReveal, markStartup, primeMetrics, registerReveal, setDatabasePath } from './perf.ts'
import { initBackups, stopBackups } from './backups.ts'
import { startUpdateChecks, stopUpdateChecks } from './updates.ts'
import { startScheduler, stopScheduler } from './scheduler.ts'
import { startWorkflowScheduler, stopWorkflowScheduler } from './workflows.ts'
import { initBackground, onAllWindowsClosed, shouldStartHidden } from './background.ts'
import { registerWindowFactory, showMainWindow } from './windows.ts'
import { engage } from './killswitch.ts'

// ---- Process-wide hardening (must run before 'ready') ----
app.enableSandbox()

// Automated tests run against a throwaway profile so they never touch your real settings or keys.
// Development builds only; packaged apps ignore this variable.
const testUserData = process.env['JARVIS_USER_DATA']
if (testUserData && !app.isPackaged) app.setPath('userData', testUserData)

// Windows: notifications only show for an app with an identity (matches electron-builder's appId).
if (process.platform === 'win32') app.setAppUserModelId('com.fosterautomation.jarvis')

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererFile = join(__dirname, '../renderer/index.html')
const rendererFileUrl = pathToFileURL(rendererFile).toString()

// Dev-only CSP (the packaged build gets a strict <meta> CSP injected at build time,
// see electron.vite.config.ts). Vite's HMR needs inline scripts and a websocket.
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (devServerUrl && u.origin === new URL(devServerUrl).origin) return true
    return u.protocol === 'file:' && u.pathname === new URL(rendererFileUrl).pathname
  } catch {
    return false
  }
}

function isAppOrigin(origin: string): boolean {
  if (devServerUrl) {
    try {
      return new URL(origin).origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }
  return origin === 'file://' || origin.startsWith('file:')
}

function openExternalSafely(url: string): void {
  try {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url)
  } catch {
    /* ignore malformed */
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'J.A.R.V.I.S.',
    backgroundColor: '#04070d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Windows/Linux: keep the menu out of the way (Alt shows it); the app has its own top bar.
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  let revealed = false
  const reveal = (): void => {
    if (revealed || win.isDestroyed()) return
    revealed = true
    win.show()
    markStartup('windowShown')
    primeMetrics()
  }
  win.once('ready-to-show', reveal)
  const wcId = win.webContents.id
  registerReveal(wcId, reveal)
  win.once('closed', () => forgetReveal(wcId))

  if (devServerUrl) void win.loadURL(devServerUrl)
  else void win.loadFile(rendererFile)

  return win
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : [{ role: 'fileMenu' as const }]),
    { role: 'editMenu' },
    {
      label: 'Jarvis',
      submenu: [
        {
          label: 'Emergency Stop',
          accelerator: 'CmdOrCtrl+Shift+.',
          click: () => engage('Emergency stop (keyboard shortcut)'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(!app.isPackaged
          ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- Guards applied to every web contents ever created ----
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      openExternalSafely(url)
    }
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })
})

// A second launch (or launching while running in the menu bar) just brings JARVIS forward.
app.on('second-instance', () => showMainWindow())

void app.whenReady().then(() => {
  markStartup('appReady')
  // Deny every permission by default. The single exception is microphone-only media access
  // requested by our own renderer (voice). Camera, screen capture, notifications, etc. stay denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const d = details as Electron.MediaAccessPermissionRequest
      const types = d.mediaTypes ?? []
      callback(types.length > 0 && types.every((t) => t === 'audio') && isAppUrl(d.requestingUrl))
      return
    }
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return permission === 'media' && isAppOrigin(requestingOrigin)
  })

  if (devServerUrl) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] },
      })
    })
  }

  // Local database (conversations; memory in later sprints). If it can't open, Jarvis still runs
  // and the UI says history is unavailable.
  const history: HistoryStore = { database: null, error: null }
  const dbPath = join(app.getPath('userData'), 'jarvis.db')
  try {
    history.database = openDatabase(dbPath)
    setDatabasePath(dbPath)
    markStartup('databaseReady')
  } catch (err) {
    history.error = err instanceof Error ? err.message : String(err)
    console.error('[db] could not open database:', history.error)
  }
  app.on('will-quit', () => history.database?.close())
  // Daily backups (Sprint 18) and restore; restore swaps history.database in place.
  initBackups(history, dbPath)
  app.on('will-quit', stopBackups)
  // Update check (Sprint 18): daily, only if the owner switched it on.
  startUpdateChecks()
  app.on('will-quit', stopUpdateChecks)

  registerIpc({ devServerUrl, rendererFileUrl }, history)
  buildMenu()
  registerWindowFactory(createWindow)
  // Background mode (opt-in): menu-bar icon + optional open at login. Opened by the OS at login
  // with background mode on → stay in the menu bar without a window.
  initBackground(history.database?.db ?? null)
  if (shouldStartHidden()) {
    if (process.platform === 'darwin') app.dock?.hide()
  } else {
    createWindow()
  }
  // Reminders fire while the app runs — with background mode, also while the window is closed.
  if (history.database) void startScheduler(history.database.db)
  app.on('will-quit', stopScheduler)
  // Saved routines on a schedule (Sprint 13): same rule — only while JARVIS runs.
  if (history.database) void startWorkflowScheduler(history.database.db)
  app.on('will-quit', stopWorkflowScheduler)

  app.on('activate', () => showMainWindow())
})

app.on('window-all-closed', () => {
  if (!onAllWindowsClosed()) app.quit()
})
