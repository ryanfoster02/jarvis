import { app, BrowserWindow, Menu, session, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc } from './ipc.ts'
import { engage } from './killswitch.ts'

// ---- Process-wide hardening (must run before 'ready') ----
app.enableSandbox()

// Automated tests run against a throwaway profile so they never touch your real settings or keys.
// Development builds only; packaged apps ignore this variable.
const testUserData = process.env['JARVIS_USER_DATA']
if (testUserData && !app.isPackaged) app.setPath('userData', testUserData)

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

  win.once('ready-to-show', () => win.show())

  if (devServerUrl) void win.loadURL(devServerUrl)
  else void win.loadFile(rendererFile)

  return win
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
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

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

void app.whenReady().then(() => {
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

  registerIpc({ devServerUrl, rendererFileUrl })
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
