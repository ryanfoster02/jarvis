# STACK

Versions verified against official sources on 2026-11-08. Re-verify before major upgrades.

| Component | Choice | Version policy | Notes |
|---|---|---|---|
| Runtime (dev) | Node.js | **≥ 22.18** (LTS 22 or 24) | 22.18+ runs `.ts` tests natively (type stripping). |
| Desktop | Electron | `^45.0.0` | Newest stable major (released 2026-10-20; Chromium 156, Node 24). Electron supports the latest 3 majors (43–45). |
| Build tooling | electron-vite | `^5.0.0` | One config for main / preload / renderer, HMR in dev. |
| Bundler | Vite | `^7.0.0` | Held at 7 until electron-vite declares Vite 8 support. |
| UI | React + react-dom | `^19.0.0` | |
| Language | TypeScript | `^5.9.0` | Strict mode. TS 6 deferred until the tooling chain confirms support. |
| Styling | CSS custom properties | — | Themes via `data-theme`. Tailwind not used: the token system is small and fully custom. |
| Fonts | `@fontsource/michroma`, `@fontsource/jetbrains-mono` | `^5.3.0` | OFL-1.1, bundled locally (CSP blocks remote fonts). Michroma = wide display/labels; JetBrains Mono = data. Added Sprint 2 for the owner-requested HUD look. |
| Tests | `node:test` (built in) + `@playwright/test` `^1.65.0` | — | Unit tests for shared logic; Playwright `_electron` end-to-end tests launch the built app with an isolated profile (`JARVIS_USER_DATA`, dev only). |
| CI | GitHub Actions (`actions/checkout@v6`, `setup-node@v6`, `upload-artifact@v6`; Node 24-based, verified 2026-11-10) | Sprint 14 | Matrix macOS / Windows / Ubuntu: typecheck, unit, e2e (Linux under xvfb with an unlocked GNOME Keyring; AppArmor user-namespace restriction lifted for Chromium's sandbox), package. Read-only token permissions, no secrets, nothing published. |
| Packaging (Windows/Linux) | electron-builder (same) | Sprint 14 | Windows: NSIS per-user installer (x64, arm64), unsigned. Linux: AppImage + .deb (x64, arm64) with keyring/tray dependencies declared. |
| Packaging | electron-builder `^26.18.0` | Sprint 4 | `electron-builder.yml`: ad-hoc signed DMG/ZIP, hardened runtime off (required for ad-hoc), mic usage string, security fuses. All runtime code is bundled into `out/`, so React/fonts are devDependencies and no node_modules ship. |
| Database | SQLite via Electron's built-in `node:sqlite` + Drizzle ORM `^0.45.4` (sqlite-proxy driver) | Sprint 5 | No native module (no rebuilds per Electron version, no install scripts). Drizzle's own node:sqlite driver is 1.0-beta only, so the stable proxy driver is used with a tested adapter (`src/main/db/executor.ts`). Migrations: hand-written SQL tracked by `PRAGMA user_version`. Drizzle is bundled into `out/main` (devDependency). |
| Voice | OpenAI Realtime API (GA) over WebRTC | Sprint 3 | Default `gpt-realtime-2.1-mini`; `gpt-realtime-2.1` selectable. `gpt-realtime-mini` is **deprecated** (verified 2026-11-08) and not used. Voices: ballad (default — closest to British English), marin, cedar, alloy, ash, ballad, coral, echo, sage, shimmer, verse. User speech transcribed with `gpt-4o-mini-transcribe` (optional; session retries without it if rejected). |
| Typed replies | OpenAI Responses API | Sprint 4 | `gpt-5.4-mini` (default; no reasoning by default, $0.75/$4.50 per 1M) or `gpt-5-mini` (reasoning effort low). `store: false`. Same persona as voice. |
| AI reasoning | Provider interface (`src/main/textProviders.ts`) | Sprint 7 | Typed replies: OpenAI Responses API or **Anthropic Messages API** (`POST https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, plain `fetch`, no SDK, no new dependency). Claude models (verified on platform.claude.com 2026-11-09): `claude-haiku-5-5` ($0.10/$0.50 per 1M up to 100k prompt tokens; $0.50/$2.50 above), `claude-sonnet-5-5` ($2/$10), `claude-opus-5-5` ($4/$20). The model picked decides the provider. Voice stays on OpenAI Realtime (Anthropic has no speech-to-speech API). |
| Credentials | Electron `safeStorage` (macOS Keychain-backed) | Sprint 3 ✅ | `userData/vault.json` (mode 600), ciphertext only; main process only. |
| Speech (TTS) | ElevenLabs REST streaming endpoint | Sprint 3 | `POST /v1/text-to-speech/{voice}/stream`, MP3 44.1 kHz, models `eleven_flash_v2_5` (default) / `eleven_v4_turbo`. Realtime session runs with `output_modalities: ['text']`; replies are chunked by sentence (`src/shared/speech.ts`) and synthesized in main; renderer plays in order with Web Audio. Voices are ElevenLabs' own (no clones of real people). Default Eldrin (6WwXjDDEMyNmFG95zycZ). |
| Integrations | MCP + official APIs | Phase 3 | Allowlisted. |
| GitHub | REST API via `fetch` (no SDK, no new dependency) | Sprint 9 | `https://api.github.com`, `Authorization: Bearer`, `X-GitHub-Api-Version: 2026-03-10` (verified 2026-11-09; its breaking changes cover rate_limit, teams, repo settings and SARIF — none used; 2022-11-28 is supported until 2028-03-10). GET only. Fine-grained personal access token (read-only) recommended; classic accepted. |
| Voice persona | Instructions (`src/shared/realtime.ts`) | Sprint 3 | British butler persona per OpenAI's realtime prompting guide: labelled sections, explicit RP accent rules, original sample phrases. No voice cloning; original character, not an imitation of any actor. |

## Key decisions
1. **electron-vite over Electron Forge** — simpler single config for three targets, well-documented React-TS template. Forge's Vite plugin is fine too; switching cost is low.
2. **No Tailwind in Sprint 1** — three themes are cleanest as CSS variables; avoids a dependency before the design system exists.
3. **Realtime voice via WebRTC "unified interface"** — the renderer creates the SDP offer; the main process posts it with the session config to `POST /v1/realtime/calls` using the stored key and returns the answer SDP. The renderer never holds any credential (not even an ephemeral one) and makes no HTTP calls to OpenAI, so CSP `connect-src` stays `'self'`. Audio flows peer-to-peer between the renderer and OpenAI.
4. **Settings stay JSON**; conversations (and, from Sprint 6, memory) live in `userData/jarvis.db`.

## Electron binary download
Electron 45 has no install script; its binary is fetched by its own `install-electron` bin. electron-vite 5 only checks `node_modules/electron/path.txt` and doesn't download it. `scripts/ensure-electron.mjs` runs Electron's installer when the binary is missing (hooked to `postinstall` in soft mode, plus `predev` / `prepreview`).

## Install-script policy (npm 12+)
`allowScripts` in package.json allows dependency install scripts for **esbuild** only (platform binary). Every other dependency's install scripts stay blocked. Review before adding entries.
