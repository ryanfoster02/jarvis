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
7. Stop all / End voice closes the peer connection and stops all tracks. Tool calls are **not** enabled in the session yet (Phase 2 permission engine first).

## AI runtime & tools (Phase 2)
`Provider` interface (`complete`, `stream`) with OpenAI first, Anthropic later. `ToolRegistry` entries declare: name, schema, risk level (low/medium/high), required scopes. Every call goes through `PermissionEngine.check(tool, args, workspace, mandate)` → `approve | needsApproval | deny`, and is bounded by `ExecutionLimits` (iterations, time, tool calls, cost, depth, concurrency).

## Data (Phase 2)
SQLite via Drizzle in main only. Tables: workspaces, conversations, messages, memories (global | workspace-scoped), integrations, permissions, mandates, tasks, execution_log. Workspace scoping enforced in the repository layer, not the UI. No credentials in these tables.

## Integration boundary (Phase 3)
Each integration: allowlist entry, status, scopes, credential reference (vault key), tools exposed, revoke action, execution history. External content is tagged untrusted and passed to the model as data, never as instructions.
