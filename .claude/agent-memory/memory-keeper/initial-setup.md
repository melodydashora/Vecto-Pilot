---
name: initial-setup
description: claude_memory table origins plus the corrections that have accumulated since — auth, category drift, sibling tables
metadata:
  type: project
---

## Memory system created 2026-04-14

- Table: `claude_memory` (PostgreSQL) — schema at `shared/schema.js` → `export const claudeMemory`
- Route: `server/api/memory/index.js`, mounted in `server/bootstrap/routes.js`
- Agent definition: `.claude/agents/memory-keeper.md`

## Corrections to the original note (verify before trusting either)

**Auth (changed 2026-05-12):** the original note said "no auth middleware, internal use
only." That was wrong even then, per the security comment at the top of
`server/api/memory/index.js` — the router IS mounted publicly, and `requireAuth` now gates
every route. See [[write-path]] for what actually works.

**Category vocabulary has drifted hard.** The agent definition documents six categories
(rule, action, insight, decision, context, feedback). The live table holds 50+ distinct
values — `audit`, `engineering-pattern`, `fix`, `session-checkpoint`, `reference`,
`doctrine-candidate` and more. Query the live distribution and match existing convention
rather than forcing a row into the documented six.

**Status values in real use:** `active`, `resolved`, `superseded`, `archived`, `pending`,
`done`, `disputed`. CLAUDE.md §6 asks for `resolved` when work lands and `superseded` when
replaced.

**`claude_memory` is one of four continuity tables**, not the only destination. Routing
rules live in CLAUDE.md §6 — see [[write-path]].
