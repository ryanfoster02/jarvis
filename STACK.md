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
| Tests | `node:test` (built in) | — | Zero-dependency unit tests for shared logic. Playwright/Electron E2E added in Sprint 4. |
| Packaging | electron-builder | added in Sprint 4 | Not needed to run in dev. |
| Database | SQLite 3 + Drizzle ORM | Phase 2 | Likely `better-sqlite3` (native, main process only). |
| Voice | OpenAI Realtime API (GA) over WebRTC | Sprint 3 | Default `gpt-realtime-2.1-mini`; `gpt-realtime-2.1` selectable. `gpt-realtime-mini` is **deprecated** (verified 2026-11-08) and not used. Voices: marin (default), cedar, alloy, ash, ballad, coral, echo, sage, shimmer, verse. User speech transcribed with `gpt-4o-mini-transcribe` (optional; session retries without it if rejected). |
| AI reasoning | Provider interface | Phase 2 | OpenAI first; Anthropic Claude pluggable. |
| Credentials | Electron `safeStorage` (macOS Keychain-backed) | Sprint 3 ✅ | `userData/vault.json` (mode 600), ciphertext only; main process only. |
| Integrations | MCP + official APIs | Phase 3 | Allowlisted. |

## Key decisions
1. **electron-vite over Electron Forge** — simpler single config for three targets, well-documented React-TS template. Forge's Vite plugin is fine too; switching cost is low.
2. **No Tailwind in Sprint 1** — three themes are cleanest as CSS variables; avoids a dependency before the design system exists.
3. **Realtime voice via WebRTC "unified interface"** — the renderer creates the SDP offer; the main process posts it with the session config to `POST /v1/realtime/calls` using the stored key and returns the answer SDP. The renderer never holds any credential (not even an ephemeral one) and makes no HTTP calls to OpenAI, so CSP `connect-src` stays `'self'`. Audio flows peer-to-peer between the renderer and OpenAI.
4. **Settings as JSON in Sprint 1** — moves to SQLite/Drizzle in Phase 2.

## Electron binary download
Electron 45 has no install script; its binary is fetched by its own `install-electron` bin. electron-vite 5 only checks `node_modules/electron/path.txt` and doesn't download it. `scripts/ensure-electron.mjs` runs Electron's installer when the binary is missing (hooked to `postinstall` in soft mode, plus `predev` / `prepreview`).

## Install-script policy (npm 12+)
`allowScripts` in package.json allows dependency install scripts for **esbuild** only (platform binary). Every other dependency's install scripts stay blocked. Review before adding entries.
