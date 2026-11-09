# IMPLEMENTATION

Current phase: Sprint 4 — Phase 1 Validation

Status key: ✅ done · 🟡 code written, needs verification on macOS · ⬜ not started

## Phase 1

### Sprint 0 — Foundation ✅
- ✅ Environment inspected; docs created (VISION, STACK, ARCHITECTURE, IMPLEMENTATION, SECURITY, CLAUDE, README)
- ✅ Git initialised, `.gitignore` excludes secrets/deps/builds; first commit (no remote; push only after owner approval)
- ✅ Sunrise / sunset scripts + Claude Code commands
- ✅ Stack versions verified (see STACK.md)

**Acceptance:** docs exist and agree; `npm run sunrise` / `npm run sunset` work; git tree clean after commit.

### Sprint 1 — Desktop Foundation ✅
- ✅ electron-vite + React + TS scaffold; Electron binary auto-download (`scripts/ensure-electron.mjs`)
- ✅ Hardened BrowserWindow (isolation, sandbox, CSP, nav/permission blocking)
- ✅ Typed IPC contract with sender + payload validation (unit-tested)
- ✅ App shell, settings persisted to JSON in userData, global kill switch

**Verified on macOS 2026-11-08:** install, typecheck, tests, launch.

### Sprint 2 — Dashboard ✅ (owner confirmed working 2026-11-08)
- 🟡 HUD visual system (owner-requested reference look): warm-black base with amber glow and star dust, corner-bracket frames, Michroma display + JetBrains Mono data (bundled, OFL), Gold default + Cyan/Azure themes
- 🟡 SVG AI core: dense bezel, segmented rings, counter-rotating triangles, level bars, JARVIS + state in the nucleus; 7 states (standing by, listening, thinking, working, speaking, needs you, stopped)
- 🟡 Top bar: Dashboard/Settings nav, workspace selector, theme chip, Stop all / Re-arm; ⌘, settings, Esc back
- 🟡 Presence legend (live state highlighted, honest availability), status terminal (provider/tokens/cost/latency — real values)
- 🟡 Operations panel: tasks, approvals, execution limits, integrations (truthful empty states)
- 🟡 Conversation panel (Enter sends, Shift+Enter newline, timestamps, pending indicator)
- 🟡 Settings: appearance (theme, reduce motion, core preview), voice, provider, permissions, notifications, connections, about
- ✅ Contract: `activeWorkspace` setting + `DEFAULT_LIMITS`, unit-tested (10 tests)

**Acceptance:** `npm install` (new font packages) + typecheck pass; every control works or says it isn't available yet; all 3 themes and all 7 core states look right on macOS; reduce-motion stops core animation; workspace + theme survive restart.

### Sprint 3 — Voice ✅ (owner verified with real keys 2026-11-08)
- ✅ Shared contract: voice/model settings, key + SDP validators, GA session builder, cost estimator, error sanitizer (18 unit tests)
- ✅ Relay request shape verified with stubbed fetch; real Chrome SDP offer accepted by validator; voice hook type-checks against DOM WebRTC types
- ✅ Credential vault (safeStorage) + Settings → AI provider (verify with OpenAI, save, replace, remove)
- ✅ Development `.env` key (`npm run setup:env`); overrides vault while set; ignored when packaged
- ✅ Mic consent (macOS) + audio-only permission policy
- ✅ WebRTC session via main-process relay; live transcripts (you + Jarvis, streaming)
- ✅ Mute, Interrupt, End voice; MIC LIVE indicator; Stop all ends voice
- ✅ Core states driven by voice events; telemetry: provider, tokens, cost estimate (2.1-mini prices), latency
- ✅ Settings → Voice: model + voice selection, JARVIS preset (Ballad + British butler persona), form of address
- ✅ ElevenLabs speech engine (default): British voices (Eldrin default), custom voice ID, Flash v2.5 / v4 Turbo, sentence-chunked TTS, ordered playback, half-duplex or barge-in, Test voice
- ✅ ElevenLabs request shape + error handling verified with stubbed fetch; SpeechQueue ordering/stop verified in headless Chrome; 31 unit tests

**Acceptance:** with the owner's key on macOS — key saves and shows ••••last4; mic prompt appears once; a spoken round-trip works with transcripts; talking over Jarvis interrupts; Mute stops input; Stop all ends the session and turns the mic off; bad key / offline show clear errors; key never appears in DevTools.

### Sprint 4 — Phase 1 Validation 🟡
- ✅ Typed replies without voice: Responses API (`gpt-5.4-mini` / `gpt-5-mini`), recent history, same persona, usage + cost + latency telemetry, optional read-aloud via ElevenLabs (request shape verified with stubbed fetch)
- ✅ Security review recorded (SECURITY.md §11); fixes: per-minute spend caps on paid channels, voice connection-drop handling, fuses for packaged builds
- ✅ Test isolation: `JARVIS_USER_DATA` profile override and no `.env` during tests (dev only)
- 🟡 Playwright end-to-end suite (8 tests: launch, isolation/bridge surface, CSP, navigation/window blocking, theme persistence, Stop all/Re-arm, honest no-key reply, settings + key validation) — written, not yet run (needs the owner's Mac)
- 🟡 Packaging: `npm run dist:mac` → ad-hoc signed DMG/ZIP with icon, mic usage string, security fuses — not yet built
- ✅ README run guide (dev, tests, e2e, packaging, installed-app key setup)
- ✅ 37 unit tests

**Acceptance:** `npm install && npm run typecheck && npm test && npm run test:e2e` all pass on macOS; `npm run dist:mac` produces a DMG; installed JARVIS launches, asks for the mic as "JARVIS", and voice works after entering keys in Settings.

## Phase 2 — Intelligence & Memory ⬜
SQLite + Drizzle · persistent conversations · global knowledge · workspace memory (view/edit/export/delete) · provider interface (OpenAI, Anthropic) · tool registry · permission engine · execution limits.

## Phase 3 — Integrations & Automation ⬜
First integration (GitHub, read-only) · allowlist & scopes UI · tool execution with approvals · scheduler (runs only while app is open — stated in UI) · reminders · execution log · worker/workflow kill levels.

## Phase 4 — Advanced ⬜
Bounded subagents (depth 1, ≤2 concurrent) · multi-step workflows · business workflows (leads, CRM, n8n, reports) · Windows/Linux builds · performance.

## Dependencies between stages
Sprint 3 needs Sprint 1 IPC + vault. Text chat needs Phase 2 provider (an interim direct OpenAI text call may land in Sprint 4). Integrations need permission engine. Scheduler needs permission engine + limits.
