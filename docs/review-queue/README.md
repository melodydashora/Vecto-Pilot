# Review Queue (post-retirement)

> **2026-04-29:** The Markdown tracking surface (`pending.md`, dated daily logs, `pending-history-2026-02.md`, `ai-coach-enhancements.md`, the Change Analyzer system) was retired. Active "unfinished work" tracking now lives in the `claude_memory` table per CLAUDE.md Rule 12 row #3 and Rule 15.

## What this directory still holds

Implementation plans (`PLAN_*.md`). Each plan is an L3 snapshot doc tied to a specific work item:
- objective + approach + files affected + test cases (Rule 1 contract)
- referenced by commits and `claude_memory` rows
- kept in version control for history

## What used to live here (no longer)

| File pattern | Replaced by |
|---|---|
| `pending.md` | `claude_memory` rows where `status = 'active'` |
| `pending-history-2026-02.md` | `claude_memory` rows where `status IN ('resolved','superseded')` + git history |
| `YYYY-MM-DD.md` daily logs | `claude_memory` rows scoped by `session_id` |
| `ai-coach-enhancements.md` | Consolidated into `docs/architecture/RIDESHARE_COACH.md` (2026-04-14) |

## Querying the new tracking layer

```bash
# All currently-active items
psql "$DATABASE_URL" -c "SELECT id, category, priority, title FROM claude_memory WHERE status = 'active' ORDER BY id DESC LIMIT 30;"

# By category
psql "$DATABASE_URL" -c "SELECT id, priority, title FROM claude_memory WHERE category = 'audit' AND status = 'active';"

# Threaded follow-ups under a parent row
psql "$DATABASE_URL" -c "SELECT id, title FROM claude_memory WHERE parent_id = N;"
```

## See also
- `CLAUDE.md` Rule 12 (session-start review protocol)
- `CLAUDE.md` Rule 15 (`claude_memory` table contract)
- `docs/superpowers/specs/2026-04-29-threading-claude-memory-followups.md` (threading discipline)
