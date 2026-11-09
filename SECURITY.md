# SECURITY

## 1. Electron hardening (in force from Sprint 1)
- `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity` on.
- Content-Security-Policy: `default-src 'self'`; no remote scripts. `connect-src` widened only for `https://api.openai.com` when voice ships.
- Navigation away from the app and `window.open` are blocked; `https:` links go to the system browser.
- Permission requests denied by default. Exception (Sprint 3): `media` requests that are **audio-only** and come from the app's own origin. Camera, screen capture, notifications, geolocation stay denied. macOS microphone consent is requested via `systemPreferences.askForMediaAccess` when voice starts.
- IPC: fixed channel allowlist in `src/shared/ipc.ts`; every handler validates the sender frame URL and the payload shape; unknown channels are never exposed.
- Preload exposes functions, never `ipcRenderer` itself.

## 2. Credentials
- Stored only in the main process, encrypted with Electron `safeStorage` (macOS Keychain-backed). Never in: renderer, frontend bundle, logs, SQLite memory tables, Git, session reports.
- Realtime voice uses the WebRTC unified interface: main relays the SDP offer with the key; the renderer never receives a credential. Keys are verified (`GET /v1/models`) before saving; only the last 4 characters are ever shown. OpenAI error bodies stay in main (they can echo key fragments); the renderer gets a sanitized message.
- `.env` (development only, git-ignored, created with mode 600 by `npm run setup:env`) may hold `OPENAI_API_KEY` and `ELEVENLABS_API_KEY`. It is read by the main process on each use, never copied into `process.env`, ignored when packaged, and overrides the vault key while set. Secrets must never use a `VITE_`-style prefix (electron-vite would bundle them into the renderer). `.env.example` holds names, never values.
- Integration OAuth is user-initiated and interactive. No unattended credential capture.

- ElevenLabs: key used only in main (`src/main/elevenlabs.ts`). The renderer sends text chunks (validated, ≤1000 chars, refused while halted) over `tts:speak` and receives MP3 bytes. Keys restricted to Text to Speech are accepted (verification treats `missing_permissions` as authenticated).
- Voices: only provider-owned or the owner's own consented voices. JARVIS does not integrate clones of real people's voices.

## 3. Risk classification
| Level | Examples | Default policy |
|---|---|---|
| Low | Read authorized data, search approved resources | Allowed within granted scopes; logged |
| Medium | Create local files, modify project code, prepare drafts | Allowed if a mandate covers it, otherwise ask; logged |
| High | Delete data, send external messages, publish/push code, change sensitive settings, any financial action | **Always** explicit per-action approval; mandates cannot waive this |

## 4. Control levels
- **Permissions** — which tools/actions exist for the agent.
- **Scopes** — which resources/operations a tool may touch (e.g. repo X read-only).
- **Mandates** — standing autonomy the user grants (e.g. "draft replies to leads daily"). A mandate never overrides a higher-priority restriction (high-risk approval, kill switch, scope).

Precedence: kill switch > high-risk approval > scope > permission > mandate.

## 5. Kill switch
| Level | Effect |
|---|---|
| Worker | Abort one running tool call/agent |
| Workflow | Abort a multi-step workflow and its children |
| Global | Halt all agent execution, cancel timers/schedules, close voice session; new execution refused until the user re-arms |

Sprint 1 ships the **global** switch state in main (`killswitch.ts`) with a UI control. Worker/workflow levels arrive with the runtime (Phase 2/3). Shortcut planned: ⌘⇧. (Cmd-Shift-Period).

## 6. Execution limits (Phase 2)
Configurable: max iterations, wall time, tool calls, token/cost budget, subagent depth (default 1 — no recursive delegation), concurrent agents (default 2). Exceeding any limit stops the run and reports.

## 7. Prompt-injection defense (Phase 2/3)
- External content (web, email, files, integration data) is wrapped and labeled untrusted; the system prompt states it is data.
- Tool calls proposed while processing untrusted content are re-checked; high-risk ones always require approval.
- No tool can change permissions, scopes, mandates or the allowlist.

## 8. Voice privacy
The mic is on only between **Start voice** and **End voice**; a red MIC LIVE chip shows whenever it is (MIC MUTED when muted — the track is disabled, not just ignored). Stop all tears down the session and releases the mic immediately. No background listening; wake word ("Hey Jarvis") is a future, opt-in feature.

## 9. Emergency procedure
1. Press **Emergency Stop** in the dashboard (or quit the app — all execution is in-process).
2. Revoke any exposed key at the provider (OpenAI dashboard, GitHub settings).
3. Record the incident in a session report.

## 10. Reporting
Security-sensitive changes (IPC, credentials, filesystem, integrations) get a focused review before merge.

## 11. Security review — Sprint 4 (2026-11-09)
Scope: Electron window/session config, preload bridge, all IPC handlers, credential vault and `.env`, OpenAI/ElevenLabs clients, renderer voice code.

| # | Check | Result |
|---|---|---|
| 1 | Every `ipcMain.handle` wrapped in `guard` (top frame + trusted origin) | ✅ 13/13 |
| 2 | Channels in preload ↔ main match one-to-one; `ipcRenderer` never exposed | ✅ |
| 3 | Payload validation: settings (allowlisted keys), chat (≤8 000 chars; history ≤20 turns/40 000 chars, roles user/assistant only — no injected system turns), TTS (≤1 000 chars), SDP (audio offer, ≤64 KB), keys (format) | ✅ unit-tested |
| 4 | Keys never reach renderer, logs, settings or Git; provider error bodies stay in main; messages sanitized | ✅ unit-tested |
| 5 | No `eval`, `new Function`, `innerHTML`, `dangerouslySetInnerHTML` | ✅ none |
| 6 | Navigation, redirects, `window.open`, `<webview>` blocked; external links `https:` only | ✅ |
| 7 | Permissions: only audio-only `media` from app origin | ✅ |
| 8 | Env overrides (`ELECTRON_RENDERER_URL`, `JARVIS_USER_DATA`, `.env`) ignored when packaged | ✅ |
| 9 | Settings and vault files written with mode 600, atomic rename | ✅ |
| 10 | **Fixed:** paid channels had no spend cap — a compromised renderer could loop requests. Added per-minute limits: chat 30, TTS 15 000 chars, voice connects 10, key checks 10 (`src/shared/ratelimit.ts`, unit-tested). | ✅ fixed |
| 11 | **Fixed:** voice `disconnected` state never ended the session; now fails cleanly after 8 s or on data-channel close. | ✅ fixed |
| 12 | **Fixed for packaging:** Electron fuses — RunAsNode, NODE_OPTIONS, `--inspect` disabled; app loads only from verified asar (`electron-builder.yml`). | ✅ |
| 13 | Accepted risk: a compromised renderer could open arbitrary `https:` links in the browser via navigation. Low impact; revisit with a link allowlist in Phase 3. | ⚠️ accepted |
| 14 | Accepted risk: packaged build is ad-hoc signed, not notarized — fine for personal use; Developer ID signing + notarization + hardened runtime before distributing (Phase 4). | ⚠️ accepted |
