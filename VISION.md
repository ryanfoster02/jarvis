# VISION — J.A.R.V.I.S.

**Just A Rather Very Intelligent System** — a local-first, voice-capable desktop assistant.

## Mission
Give one person (and later, their business) a trustworthy assistant that understands natural requests, acts only within explicitly granted authority, verifies what it did, and reports honestly.

## Target users
- Primary: the owner — an entrepreneur/developer running Foster Automation and client projects.
- Later: other individuals, developers, small-business operators.

## Core capabilities (end state)
| Area | Example request |
|---|---|
| Conversation (text + voice) | "Jarvis, good morning. What's on my schedule?" |
| Business awareness | "Summarize what happened in my business yesterday." |
| Development | "Check my GitHub repositories." |
| Tasks & reminders | "Remind me to follow up with this client tomorrow." |
| Research & drafting | "Research this company and prepare a report." / "Draft an email for this prospect." |
| Automation oversight | "Check my automation workflows." |

Pipeline for every action: **request → reasoning → tool selection → permission check → execution → verification → response.**

## User experience
- Desktop app with a futuristic, original dashboard (navy/black, cyan/azure/gold accents, three themes).
- Voice is an *interface layer*; everything works by text too.
- The UI shows real state only. Unavailable features say so — no fabricated results.

## Safety boundaries
- Connects only to services the user approves (allowlist).
- High-risk actions (delete, send, publish, spend, change sensitive settings) always need explicit approval.
- No unrestricted shell or filesystem access for the AI.
- No always-on listening without explicit opt-in and a visible indicator.
- Credentials never enter conversational memory, the renderer, or Git.
- Kill switch at worker, workflow and global level.

See [SECURITY.md](SECURITY.md).

## Long-term objectives
1. Secure desktop foundation → dashboard → voice (Phase 1).
2. Persistent memory, workspaces, tool registry, permissions (Phase 2).
3. Approved integrations, scheduler, execution logs, kill switch (Phase 3).
4. Multi-step workflows, controlled subagents, business operations, Windows/Linux (Phase 4).
