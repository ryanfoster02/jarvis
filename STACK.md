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
| Styling | CSS custom properties | — | Themes via `data-theme`. Tailwind CSS re-evaluated in Sprint 2; not added until it earns its place. |
| Tests | `node:test` (built in) | — | Zero-dependency unit tests for shared logic. Playwright/Electron E2E added in Sprint 4. |
| Packaging | electron-builder | added in Sprint 4 | Not needed to run in dev. |
| Database | SQLite 3 + Drizzle ORM | Phase 2 | Likely `better-sqlite3` (native, main process only). |
| Voice | OpenAI Realtime API over WebRTC | Sprint 3 | Default model `gpt-realtime-mini` (documented, default snapshot `gpt-realtime-mini-2025-12-15`). Newer `gpt-realtime-2.1-mini` to be evaluated in Sprint 3. Model id is a setting, never hardcoded in logic. |
| AI reasoning | Provider interface | Phase 2 | OpenAI first; Anthropic Claude pluggable. |
| Credentials | Electron `safeStorage` (macOS Keychain-backed) | Sprint 3 | Encrypted at rest in userData; main process only. |
| Integrations | MCP + official APIs | Phase 3 | Allowlisted. |

## Key decisions
1. **electron-vite over Electron Forge** — simpler single config for three targets, well-documented React-TS template. Forge's Vite plugin is fine too; switching cost is low.
2. **No Tailwind in Sprint 1** — three themes are cleanest as CSS variables; avoids a dependency before the design system exists.
3. **Realtime voice via WebRTC + ephemeral client secrets** — the main process holds the real API key and mints short-lived `ek_…` tokens via `POST /v1/realtime/client_secrets`; the renderer only ever sees the ephemeral token.
4. **Settings as JSON in Sprint 1** — moves to SQLite/Drizzle in Phase 2.
