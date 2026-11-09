import { app, ipcMain, systemPreferences, type IpcMainInvokeEvent } from 'electron'
import {
  Channels,
  IpcValidationError,
  isTrustedSenderUrl,
  isProviderId,
  validateChatMessage,
  validateConversationId,
  validateNewMessage,
  validateOptionalConversationId,
  validateProviderKey,
  validateReason,
  validateSdpOffer,
  validateSettingsPatch,
  validateTtsText,
  WORKSPACES,
  type AppInfo,
  type ChatResult,
  type ChatTurn,
  type ConversationSummary,
  type HistoryResult,
  type StoredMessage,
  type CredentialResult,
  type MicAccess,
  type TrustedOrigins,
  type TtsResult,
  type VoiceConnectResult,
} from '../shared/ipc.ts'
import { buildRealtimeSession, isTranscriptionConfigError } from '../shared/realtime.ts'
import { buildTextRequest, parseResponsesOutput } from '../shared/text.ts'
import { LIMITS, RateLimiter } from '../shared/ratelimit.ts'
import { createRealtimeCall, createTextResponse, verifyKey } from './openai.ts'
import { synthesize, verifyElevenLabsKey } from './elevenlabs.ts'
import { clearKey, credentialStatus, encryptionAvailable, getKey, saveKey } from './vault.ts'
import { loadSettings, updateSettings } from './settings.ts'
import type { Database } from './db/client.ts'
import { appendMessage, deleteConversation, getMessages, listConversations, NotFoundError, recentTurns } from './db/conversations.ts'
import { engage, getKillSwitch, isHalted, rearm } from './killswitch.ts'

/**
 * Registers every IPC handler. Each handler:
 *  1. verifies the sender is our own renderer (not an iframe or foreign page),
 *  2. validates its payload with the shared validators,
 *  3. returns plain data only.
 */
// Spend and abuse caps (per minute). See SECURITY.md, review 2026-11-09.
const limits = {
  chat: new RateLimiter(LIMITS.chatPerMinute, 60_000),
  ttsChars: new RateLimiter(LIMITS.ttsCharsPerMinute, 60_000),
  voice: new RateLimiter(LIMITS.voiceConnectsPerMinute, 60_000),
  keys: new RateLimiter(LIMITS.keyChecksPerMinute, 60_000),
}
const SLOW_DOWN = 'Too many requests in the last minute. Wait a moment and try again.'

export interface HistoryStore {
  database: Database | null
  /** Why the database couldn't open (shown in the UI), or null. */
  error: string | null
}

export function registerIpc(trusted: TrustedOrigins, history: HistoryStore): void {
  const unavailable = (): { ok: false; code: 'unavailable'; message: string } => ({
    ok: false,
    code: 'unavailable',
    message: `Conversation history is unavailable: ${history.error ?? 'database not open'}.`,
  })
  // The workspace always comes from main's own settings — never from the renderer.
  const activeWorkspace = () => loadSettings().activeWorkspace

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

  // Typed conversation (voice off): OpenAI Responses API with recent history and the same persona.
  ipcMain.handle(
    Channels.chatSend,
    guard(async (conversationId: unknown, message: unknown): Promise<ChatResult> => {
      if (isHalted()) {
        return { ok: false, code: 'halted', message: 'Stop all is engaged. Re-arm Jarvis to continue.' }
      }
      let text: string
      let convId: string | null
      try {
        text = validateChatMessage(message)
        convId = validateOptionalConversationId(conversationId)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, code: 'invalid_input', message: err.message }
        throw err
      }
      const key = getKey('openai')
      if (!key) {
        return {
          ok: false,
          code: 'no_provider',
          message: 'No AI provider is connected yet. Add your OpenAI key in Settings → AI provider.',
        }
      }
      if (!limits.chat.take()) return { ok: false, code: 'rate_limited', message: SLOW_DOWN }
      const settings = loadSettings()
      const ws = settings.activeWorkspace
      const db = history.database?.db ?? null

      // History comes from the database (scoped to the active workspace), not from the renderer.
      let turns: ChatTurn[] = []
      if (db) {
        try {
          if (convId) turns = await recentTurns(db, ws, convId)
          const stored = await appendMessage(db, ws, convId, { role: 'user', text, via: 'text' })
          convId = stored.conversationId
        } catch (err) {
          if (err instanceof NotFoundError) return { ok: false, code: 'invalid_input', message: err.message }
          throw err
        }
      }

      const workspaceName = WORKSPACES.find((w) => w.id === ws)?.name ?? 'Personal'
      const body = buildTextRequest({
        model: settings.textModel,
        workspaceName,
        persona: settings.persona,
        honorific: settings.honorific,
        history: turns,
        message: text,
      })
      const res = await createTextResponse(key, body)
      if (isHalted()) return { ok: false, code: 'halted', message: 'Stop all was engaged while Jarvis was replying.' }
      if (!res.ok) return { ok: false, code: res.status === 0 ? 'network' : 'api_error', message: res.message }
      const parsed = parseResponsesOutput(res.value)
      if (!parsed.text) {
        return { ok: false, code: 'api_error', message: 'OpenAI returned an empty reply. Try rephrasing.' }
      }
      const reply = parsed.incomplete ? `${parsed.text} …(reply cut short)` : parsed.text
      if (db && convId) await appendMessage(db, ws, convId, { role: 'assistant', text: reply, via: 'text' })
      return { ok: true, reply, model: settings.textModel, usage: parsed.usage, conversationId: convId }
    }),
  )

  // ---------- Conversation history (scoped to the active workspace) ----------

  ipcMain.handle(
    Channels.conversationsList,
    guard(async (): Promise<HistoryResult<ConversationSummary[]>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      return { ok: true, value: await listConversations(db, activeWorkspace()) }
    }),
  )

  ipcMain.handle(
    Channels.conversationsMessages,
    guard(async (conversationId: unknown): Promise<HistoryResult<StoredMessage[]>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        return { ok: true, value: await getMessages(db, activeWorkspace(), validateConversationId(conversationId)) }
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, code: 'invalid_input', message: err.message }
        if (err instanceof NotFoundError) return { ok: false, code: 'not_found', message: err.message }
        throw err
      }
    }),
  )

  // Voice transcripts are produced in the renderer, so it asks main to store them.
  ipcMain.handle(
    Channels.conversationsAppend,
    guard(async (conversationId: unknown, message: unknown): Promise<HistoryResult<StoredMessage>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        const id = validateOptionalConversationId(conversationId)
        const m = validateNewMessage(message)
        return { ok: true, value: await appendMessage(db, activeWorkspace(), id, m) }
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, code: 'invalid_input', message: err.message }
        if (err instanceof NotFoundError) return { ok: false, code: 'not_found', message: err.message }
        throw err
      }
    }),
  )

  ipcMain.handle(
    Channels.conversationsDelete,
    guard(async (conversationId: unknown): Promise<HistoryResult<boolean>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        return { ok: true, value: await deleteConversation(db, activeWorkspace(), validateConversationId(conversationId)) }
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, code: 'invalid_input', message: err.message }
        throw err
      }
    }),
  )

  // ---------- Credentials (never returns a key) ----------

  ipcMain.handle(Channels.credentialsStatus, guard(() => credentialStatus()))

  ipcMain.handle(
    Channels.credentialsSet,
    guard(async (provider: unknown, input: unknown): Promise<CredentialResult> => {
      if (!isProviderId(provider)) return { ok: false, message: 'Unknown provider.' }
      if (!limits.keys.take()) return { ok: false, message: SLOW_DOWN }
      let key: string
      try {
        key = validateProviderKey(provider, input)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, message: err.message }
        throw err
      }
      if (!encryptionAvailable()) {
        return { ok: false, message: 'Secure storage is not available on this Mac, so the key cannot be saved safely.' }
      }
      const check = provider === 'openai' ? await verifyKey(key) : await verifyElevenLabsKey(key)
      if (!check.ok) return { ok: false, message: check.message }
      saveKey(provider, key)
      return { ok: true, status: credentialStatus() }
    }),
  )

  ipcMain.handle(
    Channels.credentialsClear,
    guard((provider: unknown) => {
      if (isProviderId(provider)) clearKey(provider)
      return credentialStatus()
    }),
  )

  // ---------- Speech (ElevenLabs) ----------
  // One chunk of Jarvis's reply → MP3 bytes. Text is validated and length-capped; the key stays here.
  ipcMain.handle(
    Channels.ttsSpeak,
    guard(async (input: unknown): Promise<TtsResult> => {
      if (isHalted()) return { ok: false, code: 'halted', message: 'Stop all is engaged.' }
      let text: string
      try {
        text = validateTtsText(input)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, code: 'invalid_input', message: err.message }
        throw err
      }
      const key = getKey('elevenlabs')
      if (!key) return { ok: false, code: 'no_key', message: 'Add your ElevenLabs key in Settings → AI provider.' }
      if (!limits.ttsChars.take(text.length)) return { ok: false, code: 'api_error', message: SLOW_DOWN }
      const settings = loadSettings()
      const res = await synthesize(key, settings.elevenVoiceId, settings.elevenModel, text)
      if (isHalted()) return { ok: false, code: 'halted', message: 'Stop all is engaged.' }
      if (!res.ok) return { ok: false, code: res.status === 0 ? 'network' : 'api_error', message: res.message }
      return { ok: true, audio: res.value, characters: text.length }
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
      if (!limits.voice.take()) return { ok: false, code: 'api_error', message: SLOW_DOWN }
      let sdp: string
      try {
        sdp = validateSdpOffer(offer)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, code: 'invalid_input', message: err.message }
        throw err
      }
      const key = getKey('openai')
      if (!key) {
        return { ok: false, code: 'no_key', message: 'Add your OpenAI API key in Settings → AI provider to use voice.' }
      }
      const settings = loadSettings()
      const eleven = settings.speechEngine === 'elevenlabs'
      if (eleven && !getKey('elevenlabs')) {
        return {
          ok: false,
          code: 'no_tts_key',
          message: 'Add your ElevenLabs key in Settings → AI provider, or switch Settings → Voice → Speech engine to OpenAI.',
        }
      }
      const workspaceName = WORKSPACES.find((w) => w.id === settings.activeWorkspace)?.name ?? 'Personal'
      const base = {
        model: settings.realtimeModel,
        voice: settings.voice,
        workspaceName,
        persona: settings.persona,
        honorific: settings.honorific,
        output: eleven ? ('text' as const) : ('audio' as const),
      }

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
      return {
        ok: true,
        answerSdp: res.value,
        model: settings.realtimeModel,
        speechEngine: settings.speechEngine,
        transcription,
        bargeIn: settings.bargeIn,
      }
    }),
  )
}
