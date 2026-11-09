# J.A.R.V.I.S.

Local-first, voice-capable desktop assistant. Electron + React + TypeScript (electron-vite).

**Status:** Sprint 1 — secure desktop shell. Voice (Sprint 3), memory (Phase 2) and integrations (Phase 3) are not built yet; the UI says so where relevant. See [IMPLEMENTATION.md](IMPLEMENTATION.md).

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
| `npm run dev` | Start the app in development (HMR) |
| `npm run typecheck` | TypeScript check for main/preload and renderer |
| `npm test` | Unit tests (Node's built-in test runner) |
| `npm run build` | Typecheck + production bundle into `out/` |
| `npm run preview` | Run the production bundle |
| `npm run sunrise` | Session start briefing |
| `npm run sunset -- --done "…" --next "…"` | Write `sessions/YYYY-MM-DD_HH-mm.md` |

## Session routine (sunrise / sunset)
- **In Claude Code:** type `/sunrise` at the start and `/sunset` at the end (commands in `.claude/commands/`).
- **In a terminal:** `npm run sunrise`, or `./scripts/sunrise`. For sunset, pass one flag per bullet (all repeatable): `--title`, `--done`, `--decision`, `--issue`, `--todo`, `--next`. Git commits and changed files are added automatically.

## Configuration
Settings (theme, reduced motion) are stored in `~/Library/Application Support/jarvis/settings.json`. API keys are **never** stored there — see [SECURITY.md](SECURITY.md). `.env.example` lists dev-only variables.

## API key (.env)
For development, put your OpenAI key in a local `.env` file:
```bash
npm run setup:env     # creates .env from .env.example (never overwrites)
```
Open `.env` and paste your keys after `OPENAI_API_KEY=` and `ELEVENLABS_API_KEY=`. Then run `npm run dev` and press **Start voice**. Settings → AI provider shows "key from .env file · ending xxxx".
- `.env` is git-ignored and only read by the main process in development. Packaged builds ignore it.
- While it's set, it overrides a key saved in Settings. Edits apply the next time you start voice.
- Never rename it with a `VITE_` prefix: that would bundle the key into the interface.

## Using the app
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
