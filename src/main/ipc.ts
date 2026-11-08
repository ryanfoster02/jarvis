import { app, ipcMain, systemPreferences, type IpcMainInvokeEvent } from 'electron'
import {
  Channels,
  IpcValidationError,
  isTrustedSenderUrl,
  validateChatMessage,
  validateOpenAIKey,
  validateReason,
  validateSdpOffer,
  validateSettingsPatch,
  WORKSPACES,
  type AppInfo,
  type ChatResult,
  type CredentialResult,
  type MicAccess,
  type TrustedOrigins,
  type VoiceConnectResult,
} from '../shared/ipc.ts'
import { buildRealtimeSession, isTranscriptionConfigError } from '../shared/realtime.ts'
import { createRealtimeCall, verifyKey } from './openai.ts'
import { clearOpenAIKey, credentialStatus, encryptionAvailable, getOpenAIKey, saveOpenAIKey } from './vault.ts'
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
      const hasKey = credentialStatus().openai.configured
      return {
        ok: false,
        code: 'no_provider',
        message: hasKey
          ? 'Typed replies without voice arrive in Sprint 4. Start voice in this panel and you can talk or type to Jarvis now.'
          : 'No AI provider is connected yet. Add your OpenAI key in Settings → AI provider, then start voice.',
      }
    }),
  )

  // ---------- Credentials (never returns a key) ----------

  ipcMain.handle(Channels.credentialsStatus, guard(() => credentialStatus()))

  ipcMain.handle(
    Channels.credentialsSetOpenAI,
    guard(async (input: unknown): Promise<CredentialResult> => {
      let key: string
      try {
        key = validateOpenAIKey(input)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, message: err.message }
        throw err
      }
      if (!encryptionAvailable()) {
        return { ok: false, message: 'Secure storage is not available on this Mac, so the key cannot be saved safely.' }
      }
      const check = await verifyKey(key)
      if (!check.ok) return { ok: false, message: check.message }
      saveOpenAIKey(key)
      return { ok: true, status: credentialStatus() }
    }),
  )

  ipcMain.handle(
    Channels.credentialsClearOpenAI,
    guard(() => {
      clearOpenAIKey()
      return credentialStatus()
    }),
  )

  // ---------- Voice ----------

  // macOS asks the user once; afterwards the choice lives in System Settings → Privacy → Microphone.
  ipcMain.handle(
    Channels.voiceMicAccess,
    guard(async (): Promise<MicAccess> => {
      if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unknown'
      const status = systemPreferences.getMediaAccessStatus('microphone')
      if (status === 'granted') return 'granted'
      if (status === 'not-determined' && process.platform === 'darwin') {
        return (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied'
      }
      return status === 'restricted' ? 'restricted' : status === 'denied' ? 'denied' : 'unknown'
    }),
  )

  ipcMain.handle(
    Channels.voiceConnect,
    guard(async (offer: unknown): Promise<VoiceConnectResult> => {
      if (isHalted()) return { ok: false, code: 'halted', message: 'Stop all is engaged. Re-arm Jarvis to start voice.' }
      let sdp: string
      try {
        sdp = validateSdpOffer(offer)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, code: 'invalid_input', message: err.message }
        throw err
      }
      const key = getOpenAIKey()
      if (!key) {
        return { ok: false, code: 'no_key', message: 'Add your OpenAI API key in Settings → AI provider to use voice.' }
      }
      const settings = loadSettings()
      const workspaceName = WORKSPACES.find((w) => w.id === settings.activeWorkspace)?.name ?? 'Personal'
      const base = { model: settings.realtimeModel, voice: settings.voice, workspaceName }

      let transcription = true
      let res = await createRealtimeCall(key, sdp, buildRealtimeSession({ ...base, transcription }))
      // Transcription of your speech is optional; if OpenAI rejects that setting, connect without it.
      if (!res.ok && isTranscriptionConfigError(res.status, res.body)) {
        transcription = false
        res = await createRealtimeCall(key, sdp, buildRealtimeSession({ ...base, transcription }))
      }
      if (isHalted()) return { ok: false, code: 'halted', message: 'Stop all was engaged while connecting.' }
      if (!res.ok) {
        const code = res.status === 0 ? 'network' : res.status === 401 ? 'invalid_key' : 'api_error'
        return { ok: false, code, message: res.message }
      }
      return { ok: true, answerSdp: res.value, model: settings.realtimeModel, voice: settings.voice, transcription }
    }),
  )
}
