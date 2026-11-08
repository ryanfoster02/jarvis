# IMPLEMENTATION

Current phase: Sprint 1 — Desktop Foundation (awaiting first launch on macOS)

Status key: ✅ done · 🟡 code written, needs verification on macOS · ⬜ not started

## Phase 1

### Sprint 0 — Foundation ✅
- ✅ Environment inspected; docs created (VISION, STACK, ARCHITECTURE, IMPLEMENTATION, SECURITY, CLAUDE, README)
- ✅ Git initialised, `.gitignore` excludes secrets/deps/builds; first commit (no remote; push only after owner approval)
- ✅ Sunrise / sunset scripts + Claude Code commands
- ✅ Stack versions verified (see STACK.md)

**Acceptance:** docs exist and agree; `npm run sunrise` / `npm run sunset` work; git tree clean after commit.

### Sprint 1 — Desktop Foundation 🟡
- 🟡 electron-vite + React + TS scaffold
- 🟡 Hardened BrowserWindow (isolation, sandbox, CSP, nav/permission blocking)
- 🟡 Typed IPC contract with sender + payload validation (unit-tested ✅)
- 🟡 App shell: header, AI-core state display, conversation panel (honest "no provider" state), system panel, theme switcher, emergency stop
- 🟡 Settings persisted to JSON in userData

**Acceptance:** `npm install && npm run dev` opens the window on macOS (Apple Silicon); `npm run typecheck` and `npm test` pass; theme choice survives restart; DevTools console shows no CSP violations; `window.require`/`process` are undefined in the renderer.

### Sprint 2 — Dashboard ⬜
Full visual system (frontend-design guidance), 3 themes, animated AI core (6 states), conversation panel, workspace selector, integrations/task/security panels (truthful empty states), settings view. **Acceptance:** all controls either work or state why not; visual check in all themes.

### Sprint 3 — Voice ⬜
Credential vault (safeStorage) + settings UI for OpenAI key; ephemeral token minting; WebRTC session; mic permission flow; live transcripts; start/stop/mute; interruption; voice selection; error states. **Acceptance:** a real spoken round-trip on macOS with the owner's key; key never visible in renderer (verified via DevTools); failures surface as errors, not fake responses.

### Sprint 4 — Phase 1 Validation ⬜
Startup, text chat (needs provider), voice, network-failure and bad-key tests; security review of IPC/credentials; Playwright-Electron smoke test; packaging with electron-builder; README run guide.

## Phase 2 — Intelligence & Memory ⬜
SQLite + Drizzle · persistent conversations · global knowledge · workspace memory (view/edit/export/delete) · provider interface (OpenAI, Anthropic) · tool registry · permission engine · execution limits.

## Phase 3 — Integrations & Automation ⬜
First integration (GitHub, read-only) · allowlist & scopes UI · tool execution with approvals · scheduler (runs only while app is open — stated in UI) · reminders · execution log · worker/workflow kill levels.

## Phase 4 — Advanced ⬜
Bounded subagents (depth 1, ≤2 concurrent) · multi-step workflows · business workflows (leads, CRM, n8n, reports) · Windows/Linux builds · performance.

## Dependencies between stages
Sprint 3 needs Sprint 1 IPC + vault. Text chat needs Phase 2 provider (an interim direct OpenAI text call may land in Sprint 4). Integrations need permission engine. Scheduler needs permission engine + limits.
