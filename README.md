# J.A.R.V.I.S.

Local-first, voice-capable desktop assistant. Electron + React + TypeScript (electron-vite).

**Status:** Phase 1 complete (desktop app, dashboard, voice, typed chat, packaging). Phase 2 added memory, Claude for typed replies, and tools with approvals. Phase 3 is complete (GitHub read-only, reminders, menu-bar mode, finer stop controls). Phase 4 has started: bounded helper agents and saved routines. The UI says what isn't available yet. See [IMPLEMENTATION.md](IMPLEMENTATION.md).

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
| `npm run dist:win` | (on Windows) Build the `JARVIS-<version>-setup-<arch>.exe` installer |
| `npm run dist:linux` | (on Linux) Build `.AppImage` and `.deb` packages |
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

## Windows and Linux
Every push to `main` is built and tested on **macOS, Windows and Ubuntu** by GitHub Actions (`.github/workflows/ci.yml`: type-check, unit tests, the full e2e suite, then packaging). The installers from each run can be downloaded from the run's **Artifacts** for 7 days. CI only builds and tests: it publishes nothing and uses no secrets. To turn it off, delete that file.
- **Windows:** run `JARVIS-<version>-setup-x64.exe`. It's unsigned, so SmartScreen warns: *More info → Run anyway*. Installs per user (no admin). Keys are encrypted with Windows data protection (DPAPI). Shortcuts use **Ctrl** (Ctrl+Shift+. is Stop all; Ctrl+, opens Settings). Background mode lives in the **system tray**.
- **Linux:** use the `.AppImage` (`chmod +x`, then run) or install the `.deb`. Saving keys needs a desktop keyring (GNOME Keyring or KWallet); without one JARVIS refuses to store keys rather than store them weakly. On a bare window manager (no desktop session), start it with `--password-store=gnome-libsecret` so it uses the keyring. The tray icon needs AppIndicator support on some desktops (GNOME: the *AppIndicator* extension). *Open at login* writes `~/.config/autostart/jarvis.desktop`.
- Building: run `dist:win` on Windows and `dist:linux` on Linux (or let CI do it). Settings and the vault live in `%APPDATA%\JARVIS` (Windows) and `~/.config/JARVIS` (Linux).

## Session routine (sunrise / sunset)
- **In Claude Code:** type `/sunrise` at the start and `/sunset` at the end (commands in `.claude/commands/`).
- **In a terminal:** `npm run sunrise`, or `./scripts/sunrise`. For sunset, pass one flag per bullet (all repeatable): `--title`, `--done`, `--decision`, `--issue`, `--todo`, `--next`. Git commits and changed files are added automatically.

## Configuration
Settings are stored in `settings.json` in the app's data folder (`~/Library/Application Support/JARVIS/` on macOS, `%APPDATA%\JARVIS\` on Windows, `~/.config/JARVIS/` on Linux). API keys are **never** stored there — see [SECURITY.md](SECURITY.md). `.env.example` lists dev-only variables.

## API key (.env)
For development, put your OpenAI key in a local `.env` file:
```bash
npm run setup:env     # creates .env from .env.example (never overwrites)
```
Open `.env` and paste your keys after `OPENAI_API_KEY=` and `ELEVENLABS_API_KEY=` (optionally `ANTHROPIC_API_KEY=` to use Claude for typed replies, and `GITHUB_TOKEN=` for read-only GitHub). Then run `npm run dev` and press **Start voice**. Settings → AI provider shows "key from .env file · ending xxxx".
- `.env` is git-ignored and only read by the main process in development. Packaged builds ignore it.
- While it's set, it overrides a key saved in Settings. Edits apply the next time you start voice.
- Never rename it with a `VITE_` prefix: that would bundle the key into the interface.

## Using the app
- **Actions & approvals:** Jarvis can check the time and look up, save and delete memories, typed or by voice ("remember that I take my coffee black", "forget that"). Saving asks you first in the dashboard's **Approvals** panel (or turn on *Save memories without asking* in Settings → Permissions); deleting always asks. Everything Jarvis does or tries is listed under **Activity**. Unanswered requests expire after 2 minutes; **Stop all** answers them with no. Switch any tool off in Settings → Permissions.
- **Leads:** the **Leads** tab is a small pipeline per workspace (stages, value, next step and date, overdue highlighted). Ask Jarvis "add Ada from Acme as qualified, follow up Friday" or "what's overdue in my pipeline?" — adding and updating ask first. Try the *Weekly pipeline report* routine.
- **Webhooks (n8n, Zapier, Make, CRMs):** Settings → Connections → *Webhooks*: add a name and the webhook URL (n8n: a *Webhook* trigger node; optional *Header Auth* with header `X-JARVIS-Secret`). Then ask "send Ada's details to the CRM webhook". Jarvis shows exactly what it will send and **asks every time**. Payload: `{ source, webhook, workspace, sentAt, message, data }`.
- **Web research:** ask "research Acme Corp and tell me what they do" or "what's the latest on …". Jarvis searches the web with your typed-replies AI provider (OpenAI or Claude), answers with sources, and lists the links under the action. Each search costs about 1¢ plus tokens, so it asks first — or turn on *Search the web without asking* in Settings → Permissions.
- **Backups:** Jarvis backs up its database every day (last 7 kept). Settings → *Data*: back up now to any file, or restore from a backup — your current data is saved first. Keys and settings aren't in backups.
- **Updates:** Settings → About → *Check for updates* (or switch on the daily check). JARVIS shows the new version and opens its download page; it never installs anything itself.
- **Releasing a new version:** `npm version minor` then `git push --follow-tags`. GitHub Actions builds installers for all three systems into a *draft* release; publish it on GitHub when you're happy. Builds are unsigned: on a Mac, right-click → Open the first time.
- **Performance:** Settings → About → *Performance* shows how long startup took and the memory and CPU Jarvis uses right now (measured, not estimated). The animated core pauses while Jarvis sits in the background, so it costs nothing when you're not looking.
- **Routines:** the **Routines** tab holds saved instructions — e.g. a *Morning briefing* (start from a template). Press **Run now**, or schedule it (days + time). Results appear in the routine's history, in the conversation and as a notification. Scheduled runs only look things up (they never save, set or delete anything while you may be away) and run only while JARVIS is running.
- **Helpers:** for bigger questions with independent parts ("compare the open issues in my two repos"), Jarvis can hand each part to a helper agent — up to two at once, working in parallel. Helpers can only look things up (read-only tools), can't start helpers of their own, and each has a small budget that also counts toward your request's limit. You'll see them under **Running** with their own **Stop**. Switch off in Settings → Permissions (*Hand off to a helper*).
- **Stopping things:** while Jarvis is answering, the **Send** button becomes **Stop** (stops that request). The dashboard's **Running** panel shows what's in progress with **Stop action** (just the current step) and **Stop request**. **Stop all** (top bar, ⌘⇧., or the menu-bar icon) still halts everything.
- **Menu-bar mode:** Settings → Notifications → *Keep running in the menu bar*. Closing the window then leaves JARVIS in the menu bar so reminders still fire (voice always stops with the window). Optional *Open at login* in the installed app. Quit from the menu-bar icon or with ⌘Q.
- **Reminders:** ask Jarvis ("remind me at 3pm to call Acme") — he asks first unless you turn on *Set reminders without asking* in Settings → Permissions — or use **Add reminder** in the dashboard's Reminders panel. When one is due you get a macOS notification (Settings → Notifications), an alert on the dashboard with **Dismiss** / **Snooze**, and a note in the conversation. **Reminders fire while JARVIS is running** — window open, or in the menu bar if you turn that on; anything due while it was quit shows as *missed* next time.
- **GitHub (read-only):** Settings → **Connections**. Create a fine-grained token on github.com (Settings → Developer settings → Fine-grained tokens → *Only select repositories*; **Contents**, **Issues**, **Pull requests**: *Read-only*), paste it, then **Check and allow** each repository Jarvis may read. Ask things like "what are the open issues in my repo?", "what changed recently?" or "summarise the README". Jarvis can't comment, change, merge or push, and treats what it reads as untrusted text.
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
