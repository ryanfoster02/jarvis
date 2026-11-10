# ARCHITECTURE

## Process model

```
┌──────────────────────────── Electron main process (Node, trusted) ───────────────────────────┐
│  app lifecycle · window security · IPC handlers · settings store · kill switch              │
│  [Sprint 3] credential vault (safeStorage) · realtime token minting                          │
│  [Phase 2]  AI runtime · tool registry · permission engine · SQLite/Drizzle                  │
│  [Phase 3]  integrations (MCP/APIs, allowlisted) · scheduler · execution log                 │
└──────────────▲───────────────────────────────────────────────────────────────────────────────┘
               │ ipcRenderer.invoke / ipcMain.handle — fixed channel list, validated payloads,
               │ sender-origin check (src/shared/ipc.ts)
┌──────────────┴─────────── Preload (sandboxed, contextIsolation) ─────────────────────────────┐
│  contextBridge exposes window.jarvis = narrow typed API. No raw ipcRenderer, no Node.        │
└──────────────▲───────────────────────────────────────────────────────────────────────────────┘
┌──────────────┴─────────── Renderer (React, untrusted) ───────────────────────────────────────┐
│  Dashboard UI · AI core · conversation · settings · [Sprint 3] WebRTC voice session          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Trust rule:** the renderer is treated as untrusted. Everything privileged (keys, files, network to integrations, tool execution) lives in main and is reached only through enumerated IPC channels.

## Source layout

```
src/
  shared/      Pure TS: IPC contract, validators, types. No Electron/Node imports. Unit-tested.
  main/        Electron main: index.ts (window + security), ipc.ts (handlers), settings.ts, killswitch.ts
  preload/     contextBridge API (window.jarvis)
  renderer/    React app (index.html, src/): App.tsx (views: dashboard, settings), components/, styles/ (theme tokens + app)
tests/         node:test unit tests for src/shared
scripts/       sunrise / sunset session tooling
sessions/      session reports (YYYY-MM-DD_HH-mm.md)
```

## Window security (Sprint 1)
`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`; strict CSP; navigation and `window.open` blocked; all permission requests denied by default (microphone allowlisted in Sprint 3 only for the app's own origin); external links open in the system browser only if `https:`.

## Voice (Sprint 3)
1. **Start voice** → renderer asks main for mic consent (`voice:mic-access`, macOS prompt), then `getUserMedia({audio})`.
2. Renderer builds an `RTCPeerConnection`, adds the mic track, opens the `oai-events` data channel, creates an SDP offer.
3. `voice:connect(offer)` → main validates the offer, loads the key from the vault, builds the GA session (`src/shared/realtime.ts`: model, voice, instructions, server VAD with interruption, optional input transcription) and POSTs multipart `{sdp, session}` to `/v1/realtime/calls`. Returns only the answer SDP.
4. Audio flows peer-to-peer; events on the data channel drive state: `speech_started` → listening, `speech_stopped` → thinking, `output_audio_buffer.started/stopped` → speaking/idle, transcripts → conversation, `response.done` usage → tokens/cost, speech-end → first reply → latency.
5. Typed text during a live session goes over the data channel (`conversation.item.create` + `response.create`).
6. Mute disables the mic track; Interrupt sends `response.cancel` + `output_audio_buffer.clear`; server VAD also interrupts when you talk over Jarvis.
7. **ElevenLabs engine:** the session uses `output_modalities: ['text']`. Text deltas stream into the conversation and into a sentence chunker; each chunk goes over `tts:speak` to main, which calls ElevenLabs and returns MP3 bytes. `SpeechQueue` fetches ahead but plays strictly in order. Without barge-in, the mic track is disabled while speech plays (no self-hearing on speakers); `speech_started` or Interrupt stops playback and cancels the response.
8. Stop all / End voice closes the peer connection and stops all tracks. Tool calls are **not** enabled in the session yet (Phase 2 permission engine first).

## AI runtime & tools (Phase 2)
**Typed-reply providers (Sprint 7).** `TextProvider` (`src/main/textProviders.ts`) = `{ id, name, send(key, body), parse(json) }`, with `openai` (Responses API) and `anthropic` (Messages API) entries. Request bodies are built in pure shared code (`buildProviderRequest` in `src/shared/text.ts` → `buildAnthropicRequest` in `src/shared/anthropic.ts`) from the same persona, memory and limits as voice. `chat:send` picks the provider from `settings.textModel` and uses only that provider's key; the renderer gets the reply text, the model, the provider id and token usage. Anthropic history is normalised (starts with the user, alternating roles) before sending. Streaming is not implemented yet.

**Tools (Sprint 8).**
```
typed:  chat:send → runAgent (shared/agent.ts) ──▶ provider.send ──▶ tool calls? ──▶ executeTool ─┐
                         ▲                                                                    │
                         └──────────── results appended (OpenAI items / Anthropic tool_result) ◀┘
voice:  Realtime response.done (function_call) → renderer → tools:invoke → executeTool → function_call_output → response.create
executeTool (main/tools.ts): parseToolArgs → decide (shared/permissions.ts) → requestApproval? (main/approvals.ts) → run → logToolRun (tool_runs) → tools:run-logged event
```
- Registry: `src/shared/tools.ts` (risk, scope, strict JSON schema, owner/model descriptions, provider formats, prompt section).
- Permission engine: `decide(tool, {halted, disabled, grantedScopes, mandates})` → allow (auto | mandate) | ask | deny.
- Limits: `RunBudget` per typed request; concurrency counter in `chat:send`; voice tool calls rate-limited.
- Provider adapters in `shared/agent.ts`: OpenAI output items are passed back verbatim with `function_call_output` (with `store:false`, reasoning travels as `reasoning.encrypted_content`); Anthropic gets the assistant turn then a user turn of `tool_result` blocks.
- UI: approvals and Activity in the Ops column, "N approvals waiting" chip in the top bar, action notes in the conversation, tool switches + standing permission in Settings → Permissions.

## Data (Phase 2)
`userData/jarvis.db` opened in main at startup (`src/main/db/client.ts`): `node:sqlite` → executor → Drizzle sqlite-proxy. WAL, foreign keys on, migrations by `PRAGMA user_version` (atomic; refuses a newer schema). If it can't open, Jarvis runs without history and the UI says so.

Tables (Sprint 5): `workspaces` (seeded), `conversations` (workspace_id, title, timestamps), `messages` (role user|assistant, via text|voice, cascade delete). `memories` (Sprint 6: scope global|workspace, CHECK-enforced pairing, source user|conversation; store `src/main/db/memories.ts` with the same isolation rule). `tool_runs` (Sprint 8: action log; risk/source/decision/outcome CHECKs, per-workspace, trimmed to 500). Permissions and the memory mandate live in settings (`disabledTools`, `autoSaveMemories`). Planned: integrations, scoped mandates, tasks.

**Memory in prompts:** main loads global + active-workspace memories and `formatMemorySection` adds them to the instructions (typed and voice) under a heading that labels them as owner-saved information, never instructions; quotes neutralised, capped at 6 000 chars, placed before the Limits section.

**Workspace isolation is enforced in the repository layer** (`src/main/db/conversations.ts`): every function takes the workspace and scopes every query to it; a conversation from another workspace behaves as not found. Main supplies the active workspace from its own settings; the renderer never passes a workspace id. Typed replies load history from the database, not from the renderer. No credentials in these tables.

## GitHub (Sprint 9)
```
Settings → Connections: token (vault) + allowlist (settings.githubRepos, each checked via github:check-repo → GET /repos/{o}/{r})
model ── github_* tool call (repo ∈ enum of allowed repos) ──▶ executeTool
  → parseToolArgs (repo format, safe path/ref) → allowlist re-check (fresh settings) → decide (scope github:read)
  → src/main/github.ts githubGet (GET only) → shared/github.ts parse* (compact) → untrusted("<github_data …>") → model
```
- Scope `github:read` is granted only with a token **and** at least one allowed repository.
- Results are wrapped as untrusted data. Once a typed task or voice session has read GitHub content, `decide` ignores standing permissions (medium risk asks).
- Status shown in the Ops column (Integrations) and Settings → Connections.

## Integration boundary (Phase 3)
Each integration: allowlist entry, status, scopes, credential reference (vault key), tools exposed, revoke action, execution history. External content is tagged untrusted and passed to the model as data, never as instructions.
