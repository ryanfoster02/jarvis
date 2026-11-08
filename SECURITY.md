# SECURITY

## 1. Electron hardening (in force from Sprint 1)
- `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity` on.
- Content-Security-Policy: `default-src 'self'`; no remote scripts. `connect-src` widened only for `https://api.openai.com` when voice ships.
- Navigation away from the app and `window.open` are blocked; `https:` links go to the system browser.
- Permission requests (camera, mic, geolocation, notifications…) denied by default. Mic is allowlisted in Sprint 3 for the app origin only, and only while a voice session is active.
- IPC: fixed channel allowlist in `src/shared/ipc.ts`; every handler validates the sender frame URL and the payload shape; unknown channels are never exposed.
- Preload exposes functions, never `ipcRenderer` itself.

## 2. Credentials
- Stored only in the main process, encrypted with Electron `safeStorage` (macOS Keychain-backed). Never in: renderer, frontend bundle, logs, SQLite memory tables, Git, session reports.
- Realtime voice uses short-lived ephemeral client secrets minted by main.
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
No background listening without explicit opt-in. A visible indicator is shown whenever the mic is live. Wake word ("Hey Jarvis") is a future, opt-in feature.

## 9. Emergency procedure
1. Press **Emergency Stop** in the dashboard (or quit the app — all execution is in-process).
2. Revoke any exposed key at the provider (OpenAI dashboard, GitHub settings).
3. Record the incident in a session report.

## 10. Reporting
Security-sensitive changes (IPC, credentials, filesystem, integrations) get a focused review before merge.
