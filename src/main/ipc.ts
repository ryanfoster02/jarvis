import { app, BrowserWindow, dialog, ipcMain, systemPreferences, type IpcMainInvokeEvent } from 'electron'
import {
  Channels,
  IpcValidationError,
  isTrustedSenderUrl,
  isProviderId,
  validateChatMessage,
  validateConversationId,
  validateNewMessage,
  validateOptionalConversationId,
  validateConversationId as validateMemoryId,
  validateProviderKey,
  validateReason,
  validateSdpOffer,
  validateSettingsPatch,
  validateTtsText,
  textModelProvider,
  validateApprovalId,
  validateToolInvoke,
  validateRepoName,
  type GitHubRepoCheck,
  type Reminder,
  type BackgroundStatus,
  type RunningTask,
  type Workflow,
  type WorkflowRun,
  type Lead,
  type WebhookInfo,
  type WebhookSendResult,
  isToolName,
  DEFAULT_LIMITS,
  type ApprovalRequest,
  type ToolInvokeResult,
  type ToolName,
  type ToolRun,
  WORKSPACES,
  type AppInfo,
  type ChatResult,
  type ChatTurn,
  type ConversationSummary,
  type HistoryResult,
  type Memory,
  type MemoryExportResult,
  type StoredMessage,
  type CredentialResult,
  type MicAccess,
  type TrustedOrigins,
  type TtsResult,
  type VoiceConnectResult,
} from '../shared/ipc.ts'
import { buildRealtimeSession, isTranscriptionConfigError } from '../shared/realtime.ts'
import { buildProviderRequest, estimateTextCostUsd } from '../shared/text.ts'
import { runAgent, type AgentResult } from '../shared/agent.ts'
import { isOffered, RunBudget } from '../shared/permissions.ts'
import { specsForRequest, TOOLS } from '../shared/tools.ts'
import { isParallelSafe } from '../shared/helpers.ts'
import { getRepo, verifyGitHubToken } from './github.ts'
import {
  addReminder,
  cancelReminder,
  dismissReminder,
  listReminders,
  ReminderLimitError,
  ReminderNotFoundError,
  snoozeReminder,
} from './db/reminders.ts'
import { remindersChanged } from './scheduler.ts'
import { applyBackground, backgroundStatus } from './background.ts'
import { tasks } from './tasks.ts'
import { addWebhook, deleteWebhook, findWebhookById, listWebhooks, postWebhook, WebhookError, webhookNames } from './webhooks.ts'
import { deleteLead, LeadLimitError, LeadNotFoundError, listLeads, saveLead } from './db/leads.ts'
import { validateLeadInput } from '../shared/leads.ts'
import { validateWebhookInput, webhookPayload } from '../shared/webhooks.ts'
import { deleteWorkflow, getWorkflow, listRuns, listWorkflows, saveWorkflow, WorkflowLimitError, WorkflowNotFoundError } from './db/workflows.ts'
import { startWorkflow, WorkflowBusyError, workflowsChanged } from './workflows.ts'
import { validateWorkflowInput } from '../shared/workflows.ts'
import { parseWhen, SNOOZE_MINUTES, validateReminderText } from '../shared/reminders.ts'
import { executeTool, executeTracked, leadsChanged, permissionContext } from './tools.ts'
import { answerApproval, listApprovals } from './approvals.ts'
import { listToolRuns } from './db/toolRuns.ts'
import { TEXT_PROVIDER_IMPLS } from './textProviders.ts'
import { verifyAnthropicKey } from './anthropic.ts'
import { LIMITS, RateLimiter } from '../shared/ratelimit.ts'
import { createRealtimeCall, verifyKey } from './openai.ts'
import { synthesize, verifyElevenLabsKey } from './elevenlabs.ts'
import { clearKey, credentialStatus, encryptionAvailable, getKey, saveKey } from './vault.ts'
import { loadSettings, updateSettings } from './settings.ts'
import type { Database } from './db/client.ts'
import { appendMessage, deleteConversation, getMessages, listConversations, NotFoundError, recentTurns } from './db/conversations.ts'
import { addMemory, allMemories, deleteMemory, listMemories, MemoryLimitError, MemoryNotFoundError, memoriesForPrompt, updateMemory } from './db/memories.ts'
import { validateMemoryInput, validateMemoryText } from '../shared/memory.ts'
import { writeFile } from 'node:fs/promises'
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
  tools: new RateLimiter(LIMITS.toolCallsPerMinute, 60_000),
}
const SLOW_DOWN = 'Too many requests in the last minute. Wait a moment and try again.'
/** The current voice session has read untrusted content (SECURITY.md §7); reset on each voice connect. */
let voiceUntrusted = false

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
    guard((patch: unknown) => {
      const p = validateSettingsPatch(patch)
      const next = updateSettings(p)
      if ('runInBackground' in p || 'openAtLogin' in p) applyBackground(next)
      return next
    }),
  )

  ipcMain.handle(Channels.backgroundStatus, guard((): BackgroundStatus => backgroundStatus()))

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
      const settings = loadSettings()
      // The chosen model decides the provider; each provider uses only its own key.
      const providerId = textModelProvider(settings.textModel)
      const provider = TEXT_PROVIDER_IMPLS[providerId]
      const key = getKey(providerId)
      if (!key) {
        return {
          ok: false,
          code: 'no_provider',
          message:
            providerId === 'anthropic'
              ? 'Typed replies are set to a Claude model, but no Anthropic key is saved. Add it in Settings → AI provider, or pick an OpenAI model.'
              : 'No AI provider is connected yet. Add your OpenAI key in Settings → AI provider.',
        }
      }
      // At most DEFAULT_LIMITS.maxConcurrentAgents typed requests at once (SECURITY.md §6).
      const running = tasks.count('typed')
      if (running >= DEFAULT_LIMITS.maxConcurrentAgents) {
        return { ok: false, code: 'rate_limited', message: `Jarvis is already working on ${running} requests. Wait for one to finish, or stop one.` }
      }
      if (!limits.chat.take()) return { ok: false, code: 'rate_limited', message: SLOW_DOWN }
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
      const memories = db ? await memoriesForPrompt(db, ws) : undefined
      const toolCtx = { db, ws, workspaceName, source: 'text' as const, settings }
      // Only tools that are switched on and in scope are offered to the model at all.
      const perm = permissionContext(toolCtx)
      const tools = specsForRequest(
        Object.values(TOOLS).filter((t) => isOffered(t, perm)),
        settings.githubRepos,
        webhookNames(),
      )
      const body = buildProviderRequest({
        model: settings.textModel,
        workspaceName,
        persona: settings.persona,
        honorific: settings.honorific,
        history: turns,
        message: text,
        memories,
        tools,
      })
      const task = tasks.start('typed', text)
      let result: AgentResult
      try {
        result = await runAgent({
          provider: providerId,
          body,
          send: (b, signal) => provider.send(key, b, signal),
          parse: provider.parse,
          cost: (u) => estimateTextCostUsd(settings.textModel, u),
          execute: (call, state) => executeTracked(task, call, { ...toolCtx, untrusted: state.untrusted }),
          budget: new RunBudget(DEFAULT_LIMITS),
          halted: isHalted,
          signal: task.signal,
          // Low-risk calls in one turn (lookups, helpers) run side by side; anything that may ask waits its turn.
          parallelSafe: (n) => isParallelSafe(isToolName(n) ? TOOLS[n] : undefined),
        })
      } finally {
        task.end()
      }
      if (!result.ok) return { ok: false, code: result.code, message: result.message, actions: result.actions }
      let reply = result.text
      if (result.incomplete && result.incomplete !== 'refusal') reply = `${reply} …(reply cut short)`
      if (result.stopped) reply = `${reply ? `${reply} ` : ''}(Jarvis ${result.stopped}.)`
      if (!reply) {
        const why = result.incomplete === 'refusal' ? 'declined to answer that' : 'returned an empty reply'
        return { ok: false, code: 'api_error', message: `${provider.name} ${why}. Try rephrasing.` }
      }
      if (db && convId) await appendMessage(db, ws, convId, { role: 'assistant', text: reply, via: 'text' })
      return {
        ok: true,
        reply,
        model: settings.textModel,
        provider: providerId,
        usage: result.usage,
        conversationId: convId,
        actions: result.actions,
      }
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

  // ---------- Memory (global + active workspace; credentials refused) ----------

  const memoryError = (err: unknown): { ok: false; code: 'invalid_input' | 'not_found'; message: string } => {
    if (err instanceof IpcValidationError || err instanceof MemoryLimitError) return { ok: false, code: 'invalid_input', message: err.message }
    if (err instanceof MemoryNotFoundError) return { ok: false, code: 'not_found', message: err.message }
    throw err
  }

  ipcMain.handle(
    Channels.memoryList,
    guard(async (): Promise<HistoryResult<Memory[]>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      return { ok: true, value: await listMemories(db, activeWorkspace()) }
    }),
  )

  ipcMain.handle(
    Channels.memoryAdd,
    guard(async (input: unknown, fromConversation: unknown): Promise<HistoryResult<Memory>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        const m = validateMemoryInput(input)
        const source = fromConversation === true ? 'conversation' : 'user'
        return { ok: true, value: await addMemory(db, activeWorkspace(), { ...m, source }) }
      } catch (err) {
        return memoryError(err)
      }
    }),
  )

  ipcMain.handle(
    Channels.memoryUpdate,
    guard(async (id: unknown, text: unknown): Promise<HistoryResult<Memory>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        return { ok: true, value: await updateMemory(db, activeWorkspace(), validateMemoryId(id), validateMemoryText(text)) }
      } catch (err) {
        return memoryError(err)
      }
    }),
  )

  ipcMain.handle(
    Channels.memoryDelete,
    guard(async (id: unknown): Promise<HistoryResult<boolean>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        return { ok: true, value: await deleteMemory(db, activeWorkspace(), validateMemoryId(id)) }
      } catch (err) {
        return memoryError(err)
      }
    }),
  )

  // Export writes only to a file the owner picks in the macOS save dialog.
  ipcMain.handle(
    Channels.memoryExport,
    guard(async (): Promise<MemoryExportResult> => {
      const db = history.database?.db
      if (!db) return { ok: false, cancelled: false, message: unavailable().message }
      const all = await allMemories(db)
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const stamp = new Date().toISOString().slice(0, 10)
      const options = {
        title: 'Export JARVIS memories',
        defaultPath: `jarvis-memories-${stamp}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }
      const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (choice.canceled || !choice.filePath) return { ok: false, cancelled: true, message: 'Export cancelled.' }
      const names = Object.fromEntries(WORKSPACES.map((w) => [w.id, w.name]))
      const payload = {
        app: 'JARVIS',
        kind: 'memories',
        version: 1,
        exportedAt: new Date().toISOString(),
        memories: all.map((m) => ({
          scope: m.scope,
          workspace: m.workspaceId ? (names[m.workspaceId] ?? m.workspaceId) : null,
          text: m.text,
          source: m.source,
          createdAt: new Date(m.createdAt).toISOString(),
          updatedAt: new Date(m.updatedAt).toISOString(),
        })),
      }
      await writeFile(choice.filePath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 })
      return { ok: true, path: choice.filePath, count: all.length }
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
      const check =
        provider === 'openai'
          ? await verifyKey(key)
          : provider === 'anthropic'
            ? await verifyAnthropicKey(key)
            : provider === 'github'
              ? await verifyGitHubToken(key)
              : await verifyElevenLabsKey(key)
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
        memories: history.database ? await memoriesForPrompt(history.database.db, settings.activeWorkspace) : undefined,
        // Tools are fixed for the voice session; switching one off later is still enforced on every call.
        tools: specsForRequest(
          Object.values(TOOLS).filter((t) => isOffered(t, permissionContext({ db: history.database?.db ?? null, settings }))),
          settings.githubRepos,
          webhookNames(),
        ),
      }

      voiceUntrusted = false // new session, clean slate
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

  // ---------- Tools: approvals, action log, voice tool calls (Sprint 8) ----------

  ipcMain.handle(Channels.approvalsList, guard((): ApprovalRequest[] => listApprovals()))

  ipcMain.handle(
    Channels.approvalsDecide,
    guard((id: unknown, approve: unknown): boolean => {
      if (typeof approve !== 'boolean') return false
      try {
        return answerApproval(validateApprovalId(id), approve)
      } catch (err) {
        if (err instanceof IpcValidationError) return false
        throw err
      }
    }),
  )

  ipcMain.handle(
    Channels.toolRunsList,
    guard(async (): Promise<HistoryResult<ToolRun[]>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      return { ok: true, value: await listToolRuns(db, activeWorkspace()) }
    }),
  )

  // Voice: the Realtime model runs in the renderer's WebRTC session, so its tool calls arrive there.
  // The renderer only relays name + JSON arguments; main makes every decision (permissions,
  // approvals, kill switch, workspace) exactly as for typed replies.
  ipcMain.handle(
    Channels.toolsInvoke,
    guard(async (name: unknown, args: unknown): Promise<ToolInvokeResult> => {
      let call: { name: ToolName; args: string }
      try {
        call = validateToolInvoke(name, args)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, message: err.message }
        throw err
      }
      if (!limits.tools.take()) return { ok: false, message: SLOW_DOWN }
      const settings = loadSettings()
      const ws = settings.activeWorkspace
      // Each voice tool call is its own task, so it can be stopped from the dashboard.
      const task = tasks.start('voice', `Voice: ${TOOLS[call.name].title}`)
      const action = task.beginAction(call.name, TOOLS[call.name].title)
      let r: Awaited<ReturnType<typeof executeTool>>
      try {
        r = await executeTool(call.name, call.args, {
          db: history.database?.db ?? null,
          ws,
          workspaceName: WORKSPACES.find((w) => w.id === ws)?.name ?? 'Personal',
          source: 'voice',
          settings,
          untrusted: voiceUntrusted,
          signal: action.signal,
        })
      } finally {
        action.end()
        task.end()
      }
      if (r.untrusted) voiceUntrusted = true // rest of this voice session treated as tainted
      if (!r.note) return { ok: false, message: r.output }
      return { ok: true, output: r.output, action: r.note }
    }),
  )

  // ---------- GitHub (Sprint 9): check a repository before it goes on the allowlist ----------
  ipcMain.handle(
    Channels.githubCheckRepo,
    guard(async (input: unknown): Promise<GitHubRepoCheck> => {
      let repo: string
      try {
        repo = validateRepoName(input)
      } catch (err) {
        if (err instanceof IpcValidationError) return { ok: false, message: err.message }
        throw err
      }
      if (!limits.keys.take()) return { ok: false, message: SLOW_DOWN }
      const token = getKey('github')
      if (!token) return { ok: false, message: 'Connect GitHub first: add a token above.' }
      const r = await getRepo(token, repo)
      if (!r.ok) {
        return {
          ok: false,
          message: r.status === 404 ? `Can't see ${repo}: it doesn't exist, or your token wasn't given access to it.` : r.message,
        }
      }
      return { ok: true, repo: r.value }
    }),
  )

  // ---------- Reminders (Sprint 10): the owner's own actions, scoped to the active workspace ----------
  const reminderError = (err: unknown): { ok: false; code: 'invalid_input' | 'not_found'; message: string } => {
    if (err instanceof IpcValidationError || err instanceof ReminderLimitError) return { ok: false, code: 'invalid_input', message: err.message }
    if (err instanceof ReminderNotFoundError) return { ok: false, code: 'not_found', message: err.message }
    throw err
  }

  ipcMain.handle(
    Channels.remindersList,
    guard(async (): Promise<HistoryResult<Reminder[]>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      return { ok: true, value: await listReminders(db, activeWorkspace()) }
    }),
  )

  ipcMain.handle(
    Channels.remindersAdd,
    guard(async (input: unknown): Promise<HistoryResult<Reminder>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        if (!input || typeof input !== 'object') throw new IpcValidationError('reminder must be an object')
        const { text, dueAt } = input as { text?: unknown; dueAt?: unknown }
        const r = await addReminder(db, activeWorkspace(), { text: validateReminderText(text), dueAt: parseWhen(dueAt, Date.now()), source: 'user' })
        remindersChanged()
        return { ok: true, value: r }
      } catch (err) {
        return reminderError(err)
      }
    }),
  )

  const reminderAction =
    (fn: (db: NonNullable<HistoryStore['database']>['db'], id: string, arg: unknown) => Promise<Reminder>) =>
    async (id: unknown, arg?: unknown): Promise<HistoryResult<Reminder>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        const r = await fn(db, validateConversationId(id), arg)
        remindersChanged()
        return { ok: true, value: r }
      } catch (err) {
        return reminderError(err)
      }
    }

  ipcMain.handle(Channels.remindersCancel, guard(reminderAction((db, id) => cancelReminder(db, activeWorkspace(), id))))
  ipcMain.handle(Channels.remindersDismiss, guard(reminderAction((db, id) => dismissReminder(db, activeWorkspace(), id))))
  ipcMain.handle(
    Channels.remindersSnooze,
    guard(
      reminderAction((db, id, minutes) => {
        if (!(SNOOZE_MINUTES as readonly unknown[]).includes(minutes)) throw new IpcValidationError('snooze must be 10 or 60 minutes')
        return snoozeReminder(db, activeWorkspace(), id, Date.now() + (minutes as number) * 60_000)
      }),
    ),
  )

  // ---------- Running tasks and stop levels (Sprint 11, SECURITY.md §5) ----------
  ipcMain.handle(Channels.tasksList, guard((): RunningTask[] => tasks.list()))
  ipcMain.handle(
    Channels.tasksCancel,
    guard((id: unknown): boolean => (typeof id === 'string' && id.length <= 64 ? tasks.cancel(id) : false)),
  )
  ipcMain.handle(
    Channels.tasksCancelAction,
    guard((id: unknown, actionId: unknown): boolean => {
      if (typeof id !== 'string' || id.length > 64) return false
      if (actionId !== undefined && (typeof actionId !== 'string' || actionId.length > 64)) return false
      return tasks.cancelAction(id, actionId)
    }),
  )

  // ---------- Workflows / saved routines (Sprint 13), scoped to the active workspace ----------
  const workflowError = (err: unknown): { ok: false; code: 'invalid_input' | 'not_found'; message: string } => {
    if (err instanceof IpcValidationError || err instanceof WorkflowLimitError || err instanceof WorkflowBusyError) {
      return { ok: false, code: 'invalid_input', message: err.message }
    }
    if (err instanceof WorkflowNotFoundError) return { ok: false, code: 'not_found', message: err.message }
    throw err
  }

  ipcMain.handle(
    Channels.workflowsList,
    guard(async (): Promise<HistoryResult<Workflow[]>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      return { ok: true, value: await listWorkflows(db, activeWorkspace()) }
    }),
  )

  ipcMain.handle(
    Channels.workflowsSave,
    guard(async (input: unknown): Promise<HistoryResult<Workflow>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        const w = await saveWorkflow(db, activeWorkspace(), validateWorkflowInput(input))
        workflowsChanged()
        return { ok: true, value: w }
      } catch (err) {
        return workflowError(err)
      }
    }),
  )

  ipcMain.handle(
    Channels.workflowsDelete,
    guard(async (id: unknown): Promise<HistoryResult<true>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        await deleteWorkflow(db, activeWorkspace(), validateConversationId(id))
        workflowsChanged()
        return { ok: true, value: true }
      } catch (err) {
        return workflowError(err)
      }
    }),
  )

  ipcMain.handle(
    Channels.workflowsRun,
    guard(async (id: unknown): Promise<HistoryResult<WorkflowRun>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        if (!limits.chat.take()) return { ok: false, code: 'invalid_input', message: SLOW_DOWN }
        const wf = await getWorkflow(db, activeWorkspace(), validateConversationId(id))
        const { run, done } = await startWorkflow(db, wf, 'manual')
        void done.catch((err: unknown) => console.error('[workflows] run failed:', err))
        return { ok: true, value: run } // runs in the background; the result arrives as an event
      } catch (err) {
        return workflowError(err)
      }
    }),
  )

  ipcMain.handle(
    Channels.workflowsRuns,
    guard(async (id: unknown): Promise<HistoryResult<WorkflowRun[]>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        return { ok: true, value: await listRuns(db, activeWorkspace(), validateConversationId(id)) }
      } catch (err) {
        return workflowError(err)
      }
    }),
  )

  // ---------- Leads and webhooks (Sprint 15) — the owner's own actions ----------
  const leadError = (err: unknown): { ok: false; code: 'invalid_input' | 'not_found'; message: string } => {
    if (err instanceof IpcValidationError || err instanceof LeadLimitError) return { ok: false, code: 'invalid_input', message: err.message }
    if (err instanceof LeadNotFoundError) return { ok: false, code: 'not_found', message: err.message }
    throw err
  }

  ipcMain.handle(
    Channels.leadsList,
    guard(async (): Promise<HistoryResult<Lead[]>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      return { ok: true, value: await listLeads(db, activeWorkspace()) }
    }),
  )
  ipcMain.handle(
    Channels.leadsSave,
    guard(async (input: unknown): Promise<HistoryResult<Lead>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        const l = await saveLead(db, activeWorkspace(), validateLeadInput(input))
        leadsChanged()
        return { ok: true, value: l }
      } catch (err) {
        return leadError(err)
      }
    }),
  )
  ipcMain.handle(
    Channels.leadsDelete,
    guard(async (id: unknown): Promise<HistoryResult<true>> => {
      const db = history.database?.db
      if (!db) return unavailable()
      try {
        await deleteLead(db, activeWorkspace(), validateConversationId(id))
        leadsChanged()
        return { ok: true, value: true }
      } catch (err) {
        return leadError(err)
      }
    }),
  )

  ipcMain.handle(Channels.webhooksList, guard((): WebhookInfo[] => listWebhooks()))
  ipcMain.handle(
    Channels.webhooksAdd,
    guard((input: unknown): { ok: true; value: WebhookInfo } | { ok: false; message: string } => {
      try {
        return { ok: true, value: addWebhook(validateWebhookInput(input)) }
      } catch (err) {
        if (err instanceof IpcValidationError || err instanceof WebhookError) return { ok: false, message: err.message }
        throw err
      }
    }),
  )
  ipcMain.handle(
    Channels.webhooksDelete,
    guard((id: unknown): boolean => (typeof id === 'string' && id.length <= 64 ? deleteWebhook(id) : false)),
  )
  // The owner's own test send (not an agent action, so no approval): a fixed test payload only.
  ipcMain.handle(
    Channels.webhooksTest,
    guard(async (id: unknown): Promise<WebhookSendResult> => {
      if (typeof id !== 'string' || id.length > 64) return { ok: false, message: 'Unknown webhook.' }
      if (isHalted()) return { ok: false, message: 'Stop all is engaged. Re-arm Jarvis first.' }
      if (!limits.keys.take()) return { ok: false, message: SLOW_DOWN }
      const target = findWebhookById(id)
      if (!target) return { ok: false, message: 'Unknown webhook.' }
      const ws = activeWorkspace()
      const payload = webhookPayload({
        webhook: target.name,
        message: 'Test from JARVIS: if you can see this, the webhook works.',
        data: null,
        workspace: WORKSPACES.find((w) => w.id === ws)?.name ?? 'Personal',
        now: Date.now(),
        test: true,
      })
      return postWebhook(target, payload)
    }),
  )
}
