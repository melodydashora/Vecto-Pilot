---
name: write-path
description: The curl/API cheat sheet in the memory-keeper agent definition does not work — use psql over DATABASE_URL, and route across four tables not one
metadata:
  type: feedback
---

**Write to the continuity tables with `psql "$DATABASE_URL"`, not the curl cheat sheet.**

**Why:** the memory-keeper agent definition ships an API cheat sheet of bare
`curl http://localhost:5000/api/memory` calls. Every one of them returns
`{"error":"no_token"}` — `server/api/memory/index.js` applies `requireAuth` to the whole
router (bearer JWT, or `x-vecto-agent-secret` / `x-claude-bridge-token` service headers).
The cheat sheet predates that hardening and was never updated, so following it burns a
round-trip on a guaranteed failure every session.

**How to apply:** go straight to `psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f <file>`.
Write the statements to a scratchpad `.sql` file rather than inlining — dollar-quoting
(`$C$ ... $C$`) survives long prose bodies that would otherwise fight shell escaping, and
`RETURNING id ... \gset` lets later INSERTs in the same transaction reference the earlier
row for `parent_id` / `todo.source_memory_id` threading. Never echo `DATABASE_URL` itself.

**Route across four tables, not just `claude_memory`** (CLAUDE.md §6 is authoritative):
- `claude_memory` — decisions, patterns, audit findings, in-flight context
- `todo` — actionable items; `status` is CHECK-enforced to open/in_progress/done/wontfix,
  and `priority` is an integer where lower = more urgent
- `lessons_learned` — a mistake plus its `trigger` and the `rule` it produced
- `definitions` — glossary terms, `term` is UNIQUE

`todo.source_memory_id` and `claude_memory.parent_id` are bare integers with no FK — they
thread rows together, and nothing enforces that the target exists. Set them deliberately.

See [[verify-before-recording]] for what to check before a row goes in.
