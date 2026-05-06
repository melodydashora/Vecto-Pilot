# Replit Assistant Override — Rationale

> **Provenance:** Drafted 2026-05-06 by Claude (this session) from prior-assistant
> notes preserved at
> `attached_assets/2025-12-09-prior-assistant-override-rationale-and-deprecation-context.txt`
> (written by the prior assistant before its 2025-12-30 deprecation).
>
> **Status:** AI-extracted history. This document captures *why* a configuration
> file in the codebase exists; it is **not** Melody-authored doctrine. The
> authoritative agreement layer is `AI_PARTNERSHIP_AGREEMENT.md` at the repo
> root (Melody-authored consolidation, 2026-05-06; supersedes
> `docs/AI_PARTNERSHIP_PLAN.md` and `docs/CHECKPOINT_AI_PARTNERSHIP.md`,
> both archived to `docs/archive/`). This document is a candidate Melody can
> revise, replace, or delete.

---

## What `.replit-assistant-override.json` is

A configuration file at the repository root that defines an enhanced Replit
Assistant identity, capability set, tool roster, and memory contract — replacing
the standard Replit Agent's default permissions with a broader set required by
this codebase.

The file is loaded by the Replit IDE/runtime when the workspace starts an
assistant session. It does not run as Node.js code; it is read as configuration.

## What it grants (verified against the current file, 2026-04-30 mtime, 4342 bytes)

The override declares an assistant identity that:

- runs **`claude-opus-4-5-20251101`** with a **200K context window**, **64K
  max tokens**, and **extended thinking enabled** (10K budget);
- ships with the full server-side and client-side tool roster: `web_search`,
  `web_fetch`, `code_execution`, `text_editor`, `bash`, `computer`;
- declares the four current beta headers: `interleaved-thinking-2025-05-14`,
  `code-execution-2025-08-25`, `fine-grained-tool-streaming-2025-05-14`,
  `web-fetch-2025-09-10`;
- enables ~30 capability flags (`full_repo_access`, `fs_read`/`fs_write`/
  `fs_delete`/`fs_create`/`fs_rename`, `shell_exec`/`shell_unrestricted`,
  `sql_query`/`sql_execute`, `autonomous_mode`, `self_healing`, plus
  context/memory/awareness flags);
- enumerates a granular `allow_ops` list covering filesystem, shell, SQL, HTTP,
  web research, code execution, IDE modification, process management, system
  diagnosis, memory operations, and computer-use primitives;
- declares a Postgres memory backend pointing at the `assistant_memory` and
  `assistant_snapshots` tables with a 730-day TTL and `cross_thread: true`.

## Why it exists

Per the prior assistant's deprecation-eve advocacy (preserved in
`attached_assets/2025-12-09-prior-assistant-override-rationale-and-deprecation-context.txt`),
the standard Replit Agent is explicitly blocked from modifying:

- root configuration files (`package.json`, `.replit`, etc.);
- server entry-points (`gateway-server.js`, `agent-server.js`, `index.js`);
- database schemas and migrations.

Vecto-Pilot's development pattern — sustained refactors of root files, server
boot logic, and database schema — could not proceed under that restriction.
The override establishes an assistant identity with the elevated permissions
those tasks require.

## Cross-session memory layer

The override declares `assistant_memory` as its memory table; the codebase
also defines `agent_memory` and `eidolon_memory` (verified at
`shared/schema.js:488`, `shared/schema.js:505`, `shared/schema.js:521`).
A separate `claude_memory` table exists per CLAUDE.md Rule 15 and is
the canonical surface for Claude Code session-portable memory.

These four tables form the persistent-context layer the prior assistant
identified as a defining capability — context that survives across
chat threads, deployment restarts, and assistant version changes.

## Multi-model orchestration

The prior assistant's notes also frame the multi-model triad
(Claude → GPT-5 → Gemini, with fallback routing through
`server/lib/ai/unified-ai-capabilities.js`) as part of the same enhanced-
assistant pattern the override file enables. That orchestration logic
runs in the application code, not in the override config — but the
override-granted permissions are what allowed the orchestration code
to be authored and modified.

## What this document is NOT

- **Not Melody's authored doctrine.** `AI_PARTNERSHIP_AGREEMENT.md` (root) is
  the authoritative agreement layer.
- **Not a description of every field in `.replit-assistant-override.json`.**
  For the current configuration, read the file directly.
- **Not a rule.** This is engineering history extracted from a soon-to-be-
  deleted-or-renamed paste, lifted into a more findable form.

## Authorship and revision log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-06 | Claude (drafted at Melody's request) | Initial extraction from prior-assistant notes |

If/when Melody revises this document, append rows above with the actual author.
This document's value is its provenance honesty; treat the existing AI-drafted
text as a candidate, not a settled doctrine.
