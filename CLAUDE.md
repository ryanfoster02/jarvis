# CLAUDE.md — JARVIS project rules

## Session routine
- Start: run `npm run sunrise` and read its briefing before touching code. Don't re-read all docs.
- End: run `/sunset` (or `npm run sunset -- --done "…" --next "…"`) to write `sessions/YYYY-MM-DD_HH-mm.md`.
- Current phase lives on the `Current phase:` line of IMPLEMENTATION.md — update it when a sprint changes.

## Working rules
- One primary agent. Subagents only for clearly independent work; max 2 concurrent; never recursive.
- Inspect only relevant files. Small, testable changes. Stop after 3 failed attempts and report the blocker.
- Never fabricate results: no simulated API success, no claimed tests that didn't run. If something needs the owner's machine/keys, say it's unverified.
- Ask before: first push to a remote, creating any public repo, destructive operations, exposing credentials, consequential architecture changes.
- No new dependencies without a reason recorded in STACK.md.

## Code standards
- TypeScript strict. No `any` in IPC or security code.
- `src/shared` is pure (no Electron/Node imports) and unit-tested with `node:test` (`npm test`). Use explicit `.ts` import extensions there.
- Renderer is untrusted: no Node, no secrets, no direct network to integrations.
- Paid or sensitive IPC gets a rate limit (`src/shared/ratelimit.ts`).
- New IPC = add channel to `src/shared/ipc.ts` contract + validator + test, handler in `src/main/ipc.ts`, method in `src/preload/index.ts`. Nothing else.
- Every tool/action gets a risk level (SECURITY.md §3). High-risk always requires explicit approval.
- UI shows real state only; unavailable features say "not available yet".

## Commands
`npm run dev` · `npm run typecheck` · `npm test` · `npm run test:e2e` · `npm run build` · `npm run dist:mac` · `npm run sunrise` · `npm run sunset`

## Git
Commit per meaningful change. Never commit `.env`, keys, DBs, `out/`, `node_modules/`.
