# IMPLEMENTATION

Current phase: Phase 5 / Sprint 17 — Web research

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

### Sprint 4 — Phase 1 Validation ✅ (owner verified e2e + packaging 2026-11-09)
- ✅ Typed replies without voice: Responses API (`gpt-5.4-mini` / `gpt-5-mini`), recent history, same persona, usage + cost + latency telemetry, optional read-aloud via ElevenLabs (request shape verified with stubbed fetch)
- ✅ Security review recorded (SECURITY.md §11); fixes: per-minute spend caps on paid channels, voice connection-drop handling, fuses for packaged builds
- ✅ Test isolation: `JARVIS_USER_DATA` profile override and no `.env` during tests (dev only)
- ✅ Playwright end-to-end suite (8 tests: launch, isolation/bridge surface, CSP, navigation/window blocking, theme persistence, Stop all/Re-arm, honest no-key reply, settings + key validation) — written, not yet run (needs the owner's Mac)
- ✅ Packaging: `npm run dist:mac` → ad-hoc signed DMG/ZIP with icon, mic usage string, security fuses — not yet built
- ✅ README run guide (dev, tests, e2e, packaging, installed-app key setup)
- ✅ Fix (owner report): e2e files no longer part of the app build's type check; own `tsconfig.e2e.json` with DOM types (`npm run typecheck:e2e`)
- ✅ 37 unit tests

**Acceptance:** `npm install && npm run typecheck && npm test && npm run test:e2e` all pass on macOS; `npm run dist:mac` produces a DMG; installed JARVIS launches, asks for the mic as "JARVIS", and voice works after entering keys in Settings.

## Phase 2 — Intelligence & Memory

### Sprint 5 — Database + persistent conversations ✅ (owner ran tests after e2e fixes, 2026-11-09)
- ✅ SQLite via `node:sqlite` + Drizzle ORM 0.45 (sqlite-proxy); executor + migrations tested on real node:sqlite here (7 tests)
- ✅ Tables: workspaces (seeded), conversations, messages; WAL, foreign keys, CHECK constraints, cascade delete
- ✅ Workspace-scoped repository (list/create/messages/append/recentTurns/delete) — 5 Drizzle tests written; run with `npm test` after `npm install` (Drizzle not installable in the build sandbox)
- ✅ IPC: conversations list/messages/append/delete; chat:send stores both turns and loads history from the DB
- ✅ UI: conversation picker, New, Delete (inline confirmation), history error notice; voice transcripts saved in order; workspace switch reloads history and ends voice
- ✅ e2e: persistence across restart, workspace isolation, delete via UI

**Acceptance:** messages survive restart; switching workspace shows only that workspace's conversations; deleting removes messages; `npm test` (incl. Drizzle tests) and `npm run test:e2e` pass on macOS.

### Sprint 6 — Memory ✅ (owner verified tests + e2e 2026-11-09)
- ✅ Memory rules (`src/shared/memory.ts`): 500-char facts, 200 per scope, secret detection (API keys, tokens, passwords, card numbers, private keys) — 6 tests
- ✅ Migration 2: `memories` table with scope/workspace CHECKs; v1→v2 upgrade keeps data (tested on node:sqlite)
- ✅ Workspace-scoped store: global visible everywhere, workspace memories only at home; edit/delete isolation; limits (3 Drizzle tests — run after `npm install`)
- ✅ Prompts: memories injected into typed and voice instructions as labelled data (never instructions), capped at 6 000 chars, placed before the Limits section
- ✅ UI: Memory screen (add with scope, edit, delete with confirmation, export all as JSON via save dialog), Remember button on your messages, `/remember …` command
- ✅ e2e: add/scope/secret refusal/persist/edit/delete/`/remember`
- ⬜ Jarvis saving memories itself (voice "remember that…") — needs tools + permissions (Sprint 8)

**Acceptance:** facts saved in one workspace don't appear in another; global facts appear everywhere; Jarvis uses them in replies (typed and voice); secrets are refused; export writes a JSON file you choose; `npm test` and `npm run test:e2e` pass.

### Sprint 7 — Provider interface (Claude) ✅ (owner verified tests + e2e 2026-11-09)
- ✅ Contract: `anthropic` provider + `ANTHROPIC_API_KEY`; `sk-ant-` key validator (OpenAI validator now refuses Claude keys); Claude models in `TEXT_MODELS` with a `provider` field
- ✅ Pure helpers (`src/shared/anthropic.ts`): request builder (top-level `system`, same persona + memory), history normalisation (user-first, alternating), response parsing (text blocks, cache-aware usage, `max_tokens` / `refusal`), sanitized errors (401/403/404/429/529) — 7 tests
- ✅ Costs: Claude prices incl. Haiku 5.5's 100k prompt tier — tested
- ✅ Main: `src/main/anthropic.ts` (verify via `GET /v1/models`, Messages call) + `TextProvider` registry; `chat:send` routes by the model's provider with its own key and an honest "no Anthropic key" message — client exercised against a stubbed `fetch` here
- ✅ UI: Anthropic key form, typed-replies model picker grouped by provider with "(no key)" and an inline warning, telemetry shows "OpenAI + Claude", empty state works with a Claude key only
- ✅ e2e: Claude model without key → honest notice; Anthropic form rejects non-Claude keys
- ✅ Owner verified typecheck, tests and e2e
- ⬜ Per-workspace provider choice (deferred: global setting for now); streaming replies (with Sprint 8 tools)

**Acceptance:** with an Anthropic key saved and a Claude model picked, typed messages get Claude replies in the JARVIS persona using memories; switching back to GPT works; without the key the app says so; voice is unaffected.

### Sprint 8 — Tools, permissions, limits ✅ (owner verified 2026-11-09)
- ✅ Tool registry (`src/shared/tools.ts`): get_time (low), list_memories (low), save_memory (medium), forget_memory (high); strict schemas, argument validation (secrets refused before asking), summaries, provider formats, prompt section that matches what's actually enabled
- ✅ Permission engine (`src/shared/permissions.ts`): kill switch → scope → switched off → high always asks → low runs → medium needs a mandate or asks — tested
- ✅ Execution limits enforced (`RunBudget`): steps, time (approval waits excluded), tool calls, spend; 2 typed tasks at once; voice tool calls 30/min — tested
- ✅ Agent loop (`src/shared/agent.ts`) for OpenAI (reasoning items passed back, `function_call_output`) and Claude (`tool_use` → `tool_result` first) — tested with simulated responses
- ✅ Main: approvals queue (2-minute expiry, Stop all answers no), executor with re-check after approval, action log (migration 3, `tool_runs`), `chat:send` through the agent loop, `tools:invoke` for voice, live events
- ✅ Voice: Realtime session offers the enabled tools; function calls relayed to main and answered with `function_call_output`
- ✅ UI: Approvals cards (risk, summary, countdown, Approve/Deny), Activity list, "N approvals waiting" chip, action notes in the conversation, Settings → Permissions tool switches + "Save memories without asking"
- ✅ Jarvis saves memories himself ("remember that…"), with your approval by default
- ✅ Tests: 13 new unit tests + 1 node:sqlite migration test; 2 Drizzle log tests and 2 e2e tests run on the Mac
- ✅ Owner verified tests, e2e and live use
- ⬜ Worker/workflow-level stop (only global Stop all so far); scoped mandates beyond memory; streaming replies

**Acceptance:** Jarvis can check the time, read, save and delete memories; low risk runs, saving asks unless the standing permission is on, deleting always asks; everything appears in Activity; Stop all answers pending approvals with no; limits stop runaway loops; nothing runs while halted.

## Phase 3 — Integrations & Automation
Tool execution with approvals and the execution log already landed in Sprint 8.

### Sprint 9 — GitHub (read-only) + repository allowlist ✅ (owner moved on 2026-11-09)
- ✅ Contract: `github` credential (`GITHUB_TOKEN`), token validator (fine-grained `github_pat_` recommended, classic `ghp_` accepted), `githubRepos` allowlist setting (≤30, owner/name, links accepted), 5 tool names, `github:check-repo` channel
- ✅ `src/shared/github.ts`: GET paths (encoded; safe path/ref validation), parsers for repo, issues/PRs, issue + latest 5 comments, commits, file/folder (binary, >1 MB and long files handled), untrusted wrapper, error messages — tested on **real API responses** (fixtures from this repo) plus synthetic issues
- ✅ Tools (all low risk, scope `github:read`): `github_list_repos`, `github_list_issues`, `github_get_issue`, `github_recent_commits`, `github_read_file`; repo offered as an enum of allowed repos; allowlist re-checked in main
- ✅ Untrusted-content rule: after reading GitHub content, standing permissions stop applying for that task / voice session — tested
- ✅ Main: `src/main/github.ts` (GET only), token verify via `GET /user`, repo check before allowing; client run live against api.github.com here (repo, commits, folder, file at a ref, issues, 404)
- ✅ UI: Settings → Connections (token form with fine-grained instructions, allowlist with check-and-allow and remove), Ops column shows real GitHub status
- ✅ Tests: 8 new unit tests; 1 new e2e test (token validation, no repo without connection, tools refused without scope)
- ✅ Owner moved on to Sprint 10 (live check with a personal token still recommended)
- ⬜ Per-workspace allowlists (global for now); GitHub writes (comments, issues) — would be medium/high risk with approvals, not planned until requested

### Sprint 10 — Scheduler & reminders ✅ (owner moved on 2026-11-09)
- ✅ Contract: `Reminder` type and lifecycle, 5 channels + 2 events, settings `autoSetReminders` (off) and `reminderNotifications` (on), 3 tool names
- ✅ Rules (`src/shared/reminders.ts`): local-time parsing (with/without offset), past/too-far refused, text validation (secrets refused), startup sweep (fire recent, mark older missed), "today/tomorrow" formatting — tested in a fixed time zone
- ✅ Tools: `set_reminder` (medium; mandate available), `list_reminders` (low), `cancel_reminder` (medium, never covered by a mandate); `get_time` now returns local ISO with offset
- ✅ Storage: migration 4 `reminders` (CHECKs, FK) — constraint tests here; Drizzle store with workspace isolation — 2 tests run on the Mac
- ✅ Main: `src/main/scheduler.ts` (10 s tick, paused while halted, startup sweep, macOS notifications with click-to-focus), reminders IPC (add/cancel/dismiss/snooze), live events
- ✅ UI: Reminders in the Ops column (due/missed alerts with Dismiss and Snooze 10 min / 1 hour, upcoming list with Cancel, add form), reminder entries in the conversation (read aloud if typed replies are), status line, Settings → Notifications toggle, Permissions → "Set reminders without asking"
- ✅ Tests: 6 unit tests + SQL constraint test; 2 Drizzle tests and 2 e2e tests (a real reminder fires through the scheduler; Jarvis setting one asks first) run on the Mac
- ⬜ Repeating reminders
- ➡ Reminders while the window is closed: background mode, approved by the owner 2026-11-09 (Sprint 11)

### Sprint 11 — Background mode + worker / workflow stop levels ✅ (owner verified e2e 2026-11-10)
**Background mode (owner-approved 2026-11-09).** Opt-in "keep running in the menu bar": closing the window leaves the scheduler running behind a menu-bar icon (open, next reminder, Stop all / Re-arm, quit). Optional open at login (installed app; macOS may ask you to approve it in Login Items). No separate helper process; voice and the microphone never run without the window. One instance at a time.

**Stop levels.** Cancel one running action (worker) or a whole request (workflow) without Stop all; abort signals threaded through provider calls, approvals and GitHub reads; a Running list in the dashboard and a Stop button while Jarvis is answering.

- ✅ Background mode: settings `runInBackground` / `openAtLogin` (both off), `src/main/background.ts` (menu-bar icon with open / next reminder / Stop all · Re-arm / quit; Dock icon hidden while in the background; login item with the OS-reported status, installed app only; start without a window when opened at login), `windows.ts` (reopen from tray, notifications, second launch, Dock), Settings → Notifications → Background
- ✅ Stop levels: `TaskRegistry` (`src/shared/taskRegistry.ts`) — tested; signals through `runAgent` (tested), OpenAI/Anthropic/GitHub fetches, approvals (withdrawn on stop) and the executor (logged "Cancelled by you"); Stop all cancels all tasks; `tasks:*` IPC + live event
- ✅ UI: "Running" in the Ops column (current action, elapsed time, Stop action / Stop request), Stop button in the composer while Jarvis answers; actions that ran before a stop still show in the conversation
- ✅ Tests: 4 new unit tests (registry, stop levels in the agent loop); 2 new e2e tests (background switches; stopping an action withdraws its approval)
- ✅ Owner verified the full e2e suite (after making the harness robust to slow launches: warm-up launch, explicit launch limits, forced cleanup)
- ⬜ Background mode for voice (by design: voice needs the window)

## Phase 4 — Advanced
Bounded subagents (depth 1, ≤2 concurrent) · multi-step workflows · business workflows (leads, CRM, n8n, reports) · Windows/Linux builds · performance.

### Sprint 12 — Bounded helper agents ✅ (owner moved on 2026-11-10)
A `delegate` tool hands a focused, self-contained research subtask to a helper agent. Helpers get read-only (low-risk) tools only, never `delegate` (depth 1), their own small budget (counted against the parent request too), and at most 2 run at once. Low-risk calls in one model turn run in parallel, so two helpers work side by side. Helpers show as actions of their request in Running and can be stopped individually.
- ✅ Contract: `delegate` tool (low risk, scope `agents:delegate`), `HELPER_LIMITS`, `maxConcurrentHelpers: 2`, `RunningTask.actions[]`
- ✅ Pure: `src/shared/helpers.ts` (validation, depth rule, read-only toolset, prompt, report); `runAgent` runs consecutive low-risk calls in parallel (results in model order), adds tool-internal spend to the budget, reports taint — tested (two helpers overlap; approval-needing calls wait their turn; helper spend hits the cap)
- ✅ Registry: several actions per task, stop one by id — tested
- ✅ Main: `runHelper` in the executor (≤2 app-wide, depth check, provider key, own budget, same stop signal, Activity prefix "Helper ·"); executor refuses non-low-risk tools from helpers; scope granted only with a text-model key; Running shows "Helper: <subtask>"
- ✅ UI: Running lists every action with its own Stop; limits panel shows helper limits
- ✅ Tests: 4 new unit tests + registry rewrite; 1 new e2e test (refused without a key; switch in Permissions)
- ✅ Owner moved on (live two-helper check with a key still recommended)

### Sprint 13 — Workflows (saved routines) ✅ (owner moved on 2026-11-10)
Saved routines (name + instructions, optional weekly schedule) per workspace, run on demand or by the scheduler while JARVIS runs. Same agent loop, tools, helpers, limits, stop levels and kill switch as typed requests. Scheduled (unattended) runs get read-only tools only; manual runs use normal approvals. Results kept per routine (last 20) and announced by notification and in the conversation. Starter templates.
- ✅ Contract: `Workflow`, `WorkflowRun`, `WorkflowInput`, 5 channels + 2 events, `RunningTask.kind 'workflow'`
- ✅ Pure (`src/shared/workflows.ts`): validation, `nextRun` in local time (incl. DST), schedule wording, run message, read-only toolset for scheduled runs, 3 templates — tested in a fixed time zone
- ✅ Storage: migration 5 (`workflows`, `workflow_runs`, CHECKs incl. time format — a test caught `25:00` slipping through and the rule was tightened; runs cascade) — constraint test here; Drizzle store (scoped, keeps last 20 runs, stale-run cleanup, no catch-up) — 2 tests on the Mac
- ✅ Main: `src/main/workflows.ts` (start checks, background run via the shared pipeline, `readOnly` executor guard when scheduled, results, notification, events; 30 s schedule tick, skipped-when-busy recorded); `executeTracked` shared with typed requests
- ✅ UI: **Routines** screen (templates, editor with days/time/active, Run now, results history, delete with confirmation), routine results in the conversation, Running shows "Routine: …" with Stop request
- ✅ Tests: 4 new unit tests + SQL test; 2 Drizzle tests and 1 e2e test (template → schedule → honest failed run without a key → pause → delete) on the Mac
- ✅ Owner moved on (live run with a key still recommended)
- ⬜ Run history export; per-routine tool restrictions

### Sprint 14 — Windows & Linux builds ✅ (CI green on all three, 2026-11-10)
Packaging for Windows (NSIS installer) and Linux (AppImage, .deb); platform fixes (shortcut and wording per OS, Windows notification identity, File menu, visible tray icon, open-at-login on Windows and Linux, no insecure key storage on keyring-less Linux); a GitHub Actions CI matrix (macOS, Windows, Ubuntu) that type-checks, unit-tests, runs the e2e suite and packages on each OS — build and test only, nothing is published.
- ✅ Platform wording + shortcuts (`src/shared/platform.ts`) — tested; Settings, top bar, reminders and routines text per OS
- ✅ Main: Windows AppUserModelID, File menu + auto-hidden menu bar off macOS, gold tray icon for Windows/Linux, open at login on Windows (`--background`) and Linux (XDG autostart), start-hidden detection per OS
- ✅ Linux key storage: `basic_text` backend treated as unavailable (no weak storage) with an explanation in Settings
- ✅ Packaging: NSIS (Windows x64/arm64), AppImage + .deb (Linux x64/arm64); `dist:win`, `dist:linux`
- ✅ CI: `.github/workflows/ci.yml` — three OSes; Linux e2e under xvfb with an unlocked GNOME Keyring and Chromium's sandbox kept on; installers uploaded as artifacts; e2e made platform-neutral (tray labels, Windows file-lock-safe cleanup)
- ✅ **Proven in CI (run 42947499725, 2026-11-10):** typecheck ✓ and 119/119 unit tests (Drizzle included) on macOS, Windows and Linux; e2e 20 passed + 1 skipped on macOS and Windows, 18 passed + 3 skipped on Linux; installers built: macOS .dmg/.zip (arm64), Windows NSIS .exe (x64 + arm64), Linux AppImage + .deb (x64)
- ✅ Fixed along the way: stale package-lock (CI uses `npm install` until the lock is pushed from a machine with registry access); message/memory ordering ties now broken by insertion order (a real bug CI's faster machines exposed)
- ⚠ Linux CI has no usable keyring: after 3 attempts (unlocked GNOME Keyring; GNOME session; `--password-store=gnome-libsecret`) I stopped, per the project rules. JARVIS correctly refuses weak storage there, so the 3 key-form tests skip with a reason and a new test verifies the refusal. Saving keys on a real Linux desktop is still unverified
- ⬜ Code signing (Apple Developer ID, Windows certificate) before sharing builds with anyone else

### Sprint 15 — Business workflows (webhooks + leads) ✅ (owner set up a real webhook 2026-11-10)
Vendor-neutral first (owner didn't name specific tools): **webhooks** to n8n / Zapier / Make / any CRM automation (owner-registered, encrypted at rest, every send is high risk = approval each time, never from scheduled routines), and a local **leads** pipeline per workspace (owner UI; Jarvis can list, add and update with approval) plus a weekly pipeline-report routine template. Vendor connectors (HubSpot, Pipedrive, …) later, once the owner picks one.
- ✅ Pure: `src/shared/leads.ts`, `src/shared/webhooks.ts` + 4 tools (list_leads low, add/update_lead medium, send_webhook high; webhook enum) — 5 unit tests
- ✅ Storage: migration 6 `leads` (CHECKs) — SQL test; Drizzle store — test on Mac/CI
- ✅ Main: encrypted webhook store + sender (POST, no redirects, timeout, stop); executor cases with lead/host shown on approval cards; IPC + preload (renderer never sees URLs/secrets)
- ✅ UI: **Leads** screen (pipeline by stage, overdue, inline stage change, add/edit/delete); Settings → Connections → Webhooks (add, test, remove)
- ✅ e2e: leads flow incl. Jarvis adding with approval; webhooks against a **real local HTTP receiver** (test ping with secret header, denied send arrives nowhere, approved send arrives exactly)
- ✅ CI back on `npm ci` (lock file pushed by the owner)
- ✅ Owner set up a real webhook (2026-11-10)
- ✅ Fixed after release: pipeline cards reused the main area's `.stage` class (screens couldn't scroll); the app now fits its window down to the 1024 px minimum (shell column pinned, compact chips/columns)

### Sprint 16 — Performance ✅ (CI green on all three, 2026-11-10)
Measure first, then fix what the measurements show. Every number below comes from CI runs or a recorded local test; nothing is estimated.
- ✅ **Measured:** startup timeline (app ready → database open → window shown → dashboard ready, ms since process start) and per-process memory/CPU (`app.getAppMetrics`) — pure `src/shared/perf.ts`, `src/main/perf.ts`, `perf:get` / `perf:dashboard-ready` IPC; **Settings → About → Performance** shows them with "Measure again"
- ✅ **Renderer bundle:** electron-vite leaves the renderer unminified by default → minified; Memory, Leads, Routines and Settings load on first visit. Startup JavaScript **825 kB → 278 kB (87 kB gzip)**; lazy screens 4.8–28 kB each. `npm run check:bundle` (budget 320 kB) runs in CI after the build
- ✅ **Linux window delay:** CI's new timeline showed `ready-to-show` arriving 3.2 s after the dashboard was drawn (356 ms). The window now appears at whichever comes first → Linux window shown **3230 ms → 313 ms**
- ✅ **Idle cost:** the animated core kept the GPU busy even when nobody was looking. Animation now pauses while the window is hidden, or in the background while Jarvis stands by (approvals, running tasks, voice keep moving). Local test (software-rendered Chromium, so absolute numbers are inflated): GPU process ~100% of a core → **0%** when paused. Tried and reverted: splitting the core into GPU layers — no measurable gain here (removed the glow re-filtering but added compositing); not shipped without proof
- ✅ **SQLite:** `synchronous = NORMAL` with WAL (fewer disk syncs; no corruption risk), `PRAGMA optimize` on close; indexes were already right for every hot query
- ✅ **CI startup (run 42967596774, ms since launch):** macOS window 910 / dashboard 1030 · Windows 375 / 524 · Linux 313 / 314. Memory at rest 347–454 MB (all processes)
- ✅ Tests: 4 unit (perf), 1 DB (pragmas), 1 e2e (timeline order, usage, panel, startup ceiling 20 s); 131 unit tests on each OS
- ⬜ Owner check on the Mac: Settings → About → Performance after a normal launch; Activity Monitor with Jarvis in the background

## Phase 5 — Daily operations & release
Planned with the owner 2026-11-10. Fills the vision's remaining example requests ("what's on my schedule", "research this company", "draft an email", "check my automations", "summarize yesterday") and gets JARVIS ready to share. Owner choices: **Google** (Calendar + Gmail), **Gmail drafts via OAuth** (Jarvis drafts, never sends), **self-hosted n8n**, and **release readiness moved up** to right after research.

### Sprint 17 — Web research 🟡 (CI green 2026-11-11; live search needs the owner's key)
`web_search` tool (medium risk: costs money per search) that runs one separate request to the typed-replies provider with its built-in web search (OpenAI Responses `web_search`; Anthropic `web_search_20250305`), and returns a short report with numbered sources. Results are untrusted text. Cost ($10 per 1,000 searches + tokens) counts against the run's spend cap.
- ✅ Pure `src/shared/websearch.ts`: query validation (length, secrets), request bodies for both providers, parsing (OpenAI `url_citation` annotations + `web_search_call` count; Anthropic citations after the last result, `server_tool_use.web_search_requests`, in-band search errors), source cleaning (http(s), de-duplicated, ≤8), cost, report — 9 unit tests
- ✅ Main: `runWebSearch` (key check, 10/min cap, stop signal, cost on failure too); scope `web:search` granted with a typed-replies key; standing permission `autoWebSearch` (off by default; withdrawn after untrusted reads)
- ✅ UI: sources as links under the action in the conversation; Settings → Permissions switch *Search the web without asking*
- ✅ e2e: refused without a key (no approval, nothing sent), secret query refused, switches persist across restart
- ✅ CI run 42969858322: 140 unit tests on each OS; e2e 24 passed (macOS/Windows), 21 passed + 4 skipped (Linux)
- Changed from the plan: helpers can't search (they're limited to low-risk tools, and searches cost money); the standing permission covers the "don't ask every time" need instead
- Not verified: OpenAI does not document a per-request search cap that I could confirm, so for OpenAI models the cap of 3 is asked of the model and the actual count is billed to the budget; Anthropic enforces `max_uses: 3`
- 🟡 Owner: ask "research <a company> and tell me what they do" with a key; check the source links and the cost in the terminal

### Sprint 18 — Release readiness ⬜
macOS code signing + notarization (needs the owner's Apple Developer account), auto-update (new dependency, recorded in STACK.md), database backup/export, first-run setup guide.

### Sprint 19 — Google Calendar (read-only) ⬜
Google OAuth (desktop loopback + PKCE, tokens encrypted in main), `list_events` / free-time tools, Today panel. Creating events later, with approval.

### Sprint 20 — Gmail drafts ⬜
Same Google connection, compose scope: Jarvis creates drafts in Gmail (medium risk, approval); sending stays with the owner in Gmail.

### Sprint 21 — Automation oversight + morning briefing ⬜
Self-hosted n8n API (read-only: workflows, failed executions) and a Morning briefing routine: calendar, reminders, overdue leads, GitHub, failed automations — read aloud on request.

## Dependencies between stages
Sprint 3 needs Sprint 1 IPC + vault. Text chat needs Phase 2 provider (an interim direct OpenAI text call may land in Sprint 4). Integrations need permission engine. Scheduler needs permission engine + limits.
