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
1. Renderer asks main `voice:createSession`.
2. Main reads the OpenAI key from the vault, calls `POST /v1/realtime/client_secrets` with the configured model/voice, returns only the ephemeral secret + expiry.
3. Renderer opens `RTCPeerConnection`, adds mic track, opens `oai-events` data channel, posts SDP to `/v1/realtime/calls` with the ephemeral secret.
4. Transcripts/events drive the AI-core state machine: idle → listening → processing → speaking (→ executing / error).
5. Tool calls from the voice model are **not** executed in the renderer; they are forwarded to main's permission engine (Phase 2+).

## AI runtime & tools (Phase 2)
`Provider` interface (`complete`, `stream`) with OpenAI first, Anthropic later. `ToolRegistry` entries declare: name, schema, risk level (low/medium/high), required scopes. Every call goes through `PermissionEngine.check(tool, args, workspace, mandate)` → `approve | needsApproval | deny`, and is bounded by `ExecutionLimits` (iterations, time, tool calls, cost, depth, concurrency).

## Data (Phase 2)
SQLite via Drizzle in main only. Tables: workspaces, conversations, messages, memories (global | workspace-scoped), integrations, permissions, mandates, tasks, execution_log. Workspace scoping enforced in the repository layer, not the UI. No credentials in these tables.

## Integration boundary (Phase 3)
Each integration: allowlist entry, status, scopes, credential reference (vault key), tools exposed, revoke action, execution history. External content is tagged untrusted and passed to the model as data, never as instructions.
