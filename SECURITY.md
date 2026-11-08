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
- `.env` is for local development only and is git-ignored; `.env.example` holds names, never values.
- Integration OAuth is user-initiated and interactive. No unattended credential capture.

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
