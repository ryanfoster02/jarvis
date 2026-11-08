---
description: End-of-session report for JARVIS
---
Write the session report. Steps:

1. Commit any finished work first (ask if anything is half-done).
2. From this session only, collect short bullets: completed work, architectural decisions, errors/open problems, remaining tasks, next recommended actions. Be accurate — mark anything not verified as unverified.
3. If the sprint changed, update the `Current phase:` line and status icons in IMPLEMENTATION.md.
4. Run, with one flag per bullet (repeatable):
   `npm run sunset --silent -- --title "<short title>" --done "…" --decision "…" --issue "…" --todo "…" --next "…"`
5. Commit the new `sessions/*.md` file with message `chore(session): sunset report`.

Keep bullets under ~15 words each.
