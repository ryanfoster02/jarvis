import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  Channels,
  IpcValidationError,
  isTrustedSenderUrl,
  validateChatMessage,
  validateReason,
  validateSettingsPatch,
  type AppInfo,
  type ChatResult,
  type TrustedOrigins,
} from '../shared/ipc.ts'
import { loadSettings, updateSettings } from './settings.ts'
import { engage, getKillSwitch, isHalted, rearm } from './killswitch.ts'

/**
 * Registers every IPC handler. Each handler:
 *  1. verifies the sender is our own renderer (not an iframe or foreign page),
 *  2. validates its payload with the shared validators,
 *  3. returns plain data only.
 */
export function registerIpc(trusted: TrustedOrigins): void {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A): R => {
      const frame = event.senderFrame
      const isTop = frame != null && frame.parent === null // reject iframes
      if (!isTop || !isTrustedSenderUrl(frame?.url, trusted)) {
        throw new Error('IPC rejected: untrusted sender')
      }
      return fn(...args)
    }

  ipcMain.handle(
    Channels.appInfo,
    guard((): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      versions: {
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        node: process.versions.node,
      },
      isPackaged: app.isPackaged,
    })),
  )

  ipcMain.handle(Channels.settingsGet, guard(() => loadSettings()))

  ipcMain.handle(
    Channels.settingsUpdate,
    guard((patch: unknown) => updateSettings(validateSettingsPatch(patch))),
  )

  ipcMain.handle(Channels.killSwitchGet, guard(() => getKillSwitch()))
  ipcMain.handle(Channels.killSwitchEngage, guard((reason: unknown) => engage(validateReason(reason))))
  ipcMain.handle(Channels.killSwitchRearm, guard(() => rearm()))

  // Text conversation entry point. No AI provider exists yet (Phase 2 / Sprint 4),
  // so this reports that truthfully instead of producing a fake reply.
  ipcMain.handle(
    Channels.chatSend,
    guard((message: unknown): ChatResult => {
      if (isHalted()) {
        return { ok: false, code: 'halted', message: 'Emergency stop is engaged. Re-arm JARVIS to continue.' }
      }
      try {
        validateChatMessage(message)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, code: 'invalid_input', message: err.message }
        throw err
      }
      return {
        ok: false,
        code: 'no_provider',
        message: 'No AI provider is connected yet. Your message reached the main process, but replies arrive once a provider is configured (Sprint 3–4).',
      }
    }),
  )
}
