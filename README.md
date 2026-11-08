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

## Using the app (Sprint 1)
- **Theme:** the three dots top-right (Gold / Azure / Cyan). Persists across restarts.
- **Emergency Stop:** button in the Security panel or **⌘⇧.** — halts execution until you re-arm.
- **Conversation:** messages go to the main process; until an AI provider is connected you'll get an explicit "no provider" notice instead of a reply.

## Docs
[VISION](VISION.md) · [STACK](STACK.md) · [ARCHITECTURE](ARCHITECTURE.md) · [IMPLEMENTATION](IMPLEMENTATION.md) · [SECURITY](SECURITY.md) · [CLAUDE](CLAUDE.md)
