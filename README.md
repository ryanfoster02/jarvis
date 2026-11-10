# J.A.R.V.I.S.

Local-first, voice-capable desktop assistant. Electron + React + TypeScript (electron-vite).

**Status:** Phase 1 complete (desktop app, dashboard, voice, typed chat, packaging). Phase 2 adds memory, Claude for typed replies, and tools with approvals; integrations (Phase 3) are not built yet, and the UI says so where relevant. See [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Requirements
- macOS (Apple Silicon or Intel). Windows/Linux later.
- Node.js **22.18+** (`node -v`). Install via [nodejs.org](https://nodejs.org) or `brew install node@22`.
- Git.

## Install & run
```bash
cd jarvis
npm install          # downloads Electron 45 (~100 MB) on first install
npm run dev          # launches the app with hot reload
```

> **Electron binary:** Electron 45+ doesn't download its app binary during `npm install` anymore. This project does it automatically (`postinstall`, and again before `npm run dev` / `npm run preview` if still missing) via `scripts/ensure-electron.mjs`. To run it by hand: `npm run setup:electron`. If you ever see `Error: Electron uninstall`, that's the fix.

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development (hot reload) |
| `npm run typecheck` | TypeScript check (main, preload, renderer, tests) |
| `npm test` | Unit tests (Node's built-in runner, no app launch) |
| `npm run test:e2e` | Builds, then launches the real app with a throwaway profile and clicks through it (Playwright). Never uses your settings, keys or `.env`. |
| `npm run build` | Typecheck + production bundle into `out/` |
| `npm run preview` | Run the production bundle |
| `npm run dist:mac` | Build **JARVIS.app** as a `.dmg` and `.zip` in `release/<version>/` |
| `npm run setup:env` | Create `.env` from `.env.example` |
| `npm run sunrise` / `npm run sunset -- --done "…"` | Session briefing / session report |

## Installing JARVIS as a Mac app
```bash
npm install            # once, after pulling (adds electron-builder and Playwright)
npm run dist:mac
```
Open `release/0.1.0/JARVIS-0.1.0-arm64.dmg` (or `-x64` on Intel) and drag **JARVIS** into Applications.
- The build is ad-hoc signed: it runs on the Mac that built it. It isn't notarized, so it's not for sharing yet.
- The installed app **ignores `.env`**. Keys you saved in Settings → AI provider during development carry over (same profile); otherwise add them there once. macOS may ask once whether JARVIS can use "JARVIS Safe Storage" in your keychain: choose **Always Allow**.
- macOS will ask for microphone access for **JARVIS** the first time you start voice.
- Settings and the encrypted key vault live in `~/Library/Application Support/JARVIS/`, shared by the dev build and the installed app.

## Session routine (sunrise / sunset)
- **In Claude Code:** type `/sunrise` at the start and `/sunset` at the end (commands in `.claude/commands/`).
- **In a terminal:** `npm run sunrise`, or `./scripts/sunrise`. For sunset, pass one flag per bullet (all repeatable): `--title`, `--done`, `--decision`, `--issue`, `--todo`, `--next`. Git commits and changed files are added automatically.

## Configuration
Settings are stored in `~/Library/Application Support/JARVIS/settings.json`. API keys are **never** stored there — see [SECURITY.md](SECURITY.md). `.env.example` lists dev-only variables.

## API key (.env)
For development, put your OpenAI key in a local `.env` file:
```bash
npm run setup:env     # creates .env from .env.example (never overwrites)
```
Open `.env` and paste your keys after `OPENAI_API_KEY=` and `ELEVENLABS_API_KEY=` (and optionally `ANTHROPIC_API_KEY=` to use Claude for typed replies). Then run `npm run dev` and press **Start voice**. Settings → AI provider shows "key from .env file · ending xxxx".
- `.env` is git-ignored and only read by the main process in development. Packaged builds ignore it.
- While it's set, it overrides a key saved in Settings. Edits apply the next time you start voice.
- Never rename it with a `VITE_` prefix: that would bundle the key into the interface.

## Using the app
- **Actions & approvals:** Jarvis can check the time and look up, save and delete memories, typed or by voice ("remember that I take my coffee black", "forget that"). Saving asks you first in the dashboard's **Approvals** panel (or turn on *Save memories without asking* in Settings → Permissions); deleting always asks. Everything Jarvis does or tries is listed under **Activity**. Unanswered requests expire after 2 minutes; **Stop all** answers them with no. Switch any tool off in Settings → Permissions.
- **Memory:** the MEMORY tab lists facts Jarvis knows: for this workspace and for all workspaces. Add, edit, delete (asks first) or export everything as JSON. In a conversation, type `/remember …` or press **Remember** under one of your messages. Jarvis uses memories in typed and spoken replies; it refuses to store passwords or keys.
- **History:** the Conversation panel's picker lists this workspace's saved conversations. **New** starts a fresh one; **Delete** removes the current one (asks first). Switching workspace shows only that workspace's conversations and ends any voice session. Stored locally in `~/Library/Application Support/JARVIS/jarvis.db`.
- **Typing:** with voice off, typed messages get typed replies (GPT-5.4 mini by default, same personality), read aloud with the ElevenLabs voice if *Read typed replies aloud* is on. Conversations are saved per workspace and survive restarts.
- **Voice:** add your key via `.env` (above) or Settings → AI provider → *Verify and save*. Then on the dashboard press **Start voice** and allow the microphone. Talk naturally; talk over Jarvis to interrupt, or press **Interrupt**. **Mute** turns the mic off; **End voice** closes the session. While voice is on you can also type, and Jarvis answers by voice.
- **Jarvis's voice (default: ElevenLabs).** OpenAI listens and thinks; ElevenLabs speaks with a real British voice. Default voice **Eldrin** (crisp British baritone); **Finley**, and legacy **George** / **Daniel** (retired by ElevenLabs on Dec 31 2026, older accounts only) are selectable, or paste any voice ID from your own ElevenLabs account. Use **Test voice** in Settings → Voice to hear it. Library voices may need *Add to My Voices* in ElevenLabs first.
- **Talking over Jarvis:** with ElevenLabs on speakers, the mic pauses while Jarvis speaks (chip shows MIC PAUSED) so it doesn't hear itself — press **Interrupt** to cut in. Turn on *Talk over Jarvis (headphones)* to interrupt by voice.
- **OpenAI voices** remain available (Settings → Voice → Speech engine): Ballad + British butler personality as a fallback.
- **Privacy:** the mic is only on during a voice session; the top bar shows **MIC LIVE**. In development macOS lists the app as "Electron" under Privacy & Security → Microphone.
- **Stop all** (top bar, or ⌘⇧.) ends voice and halts everything until you press **Re-arm**.
- **Theme:** the THEME chip cycles Gold / Cyan / Azure. **Workspace** selector is in the top bar.
- **Telemetry** under the core: provider, tokens used this session, estimated cost, and reply latency — all measured, nothing simulated.

## Docs
[VISION](VISION.md) · [STACK](STACK.md) · [ARCHITECTURE](ARCHITECTURE.md) · [IMPLEMENTATION](IMPLEMENTATION.md) · [SECURITY](SECURITY.md) · [CLAUDE](CLAUDE.md)
