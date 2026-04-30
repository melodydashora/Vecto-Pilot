---
name: threading-claude-memory-followups
description: Use when about to INSERT a row into claude_memory with a `Followup:`, `Resolution:`, or `Update:` prefix — the prefix signals "continuing prior thought," which requires identifying the antecedent (memory row vs. external) before deciding parent_id.
---

# threading-claude-memory-followups

## When this fires
You're about to INSERT into `claude_memory` with title `Followup:`, `Resolution:`, or `Update:`.

## Step 1 — run this
```sql
SELECT id, title FROM claude_memory ORDER BY id DESC LIMIT 20;
```

## Step 2 — pick one shape

**Shape A — antecedent IS in that result:**
`parent_id = <antecedent's id>`; body may reference `"Building on #N: …"`.

**Shape B — antecedent is external** (the source of what the row is *about* — `user-input`, `browser-state`, `code-inspection`, `external-doc`, `conversation`):
`parent_id = NULL`; body MUST start with `Antecedent: <kind> — <description>`.

## Examples

**Shape A:**
```
title:    Followup: deferred P3 plan
parent:   251
body:     Building on #251: P3 was deferred because…
```

**Shape B:**
```
title:    Followup: SSE 4-channel drop
parent:   NULL
body:     Antecedent: user-input — browser console screenshot showed 4 SSE
          channels errored at the same millisecond. Pattern fingerprint =
          workflow restart, NOT a bug.
```

**Shape B (code finding):**
```
title:    Resolution: filter-for-planner tz-naive date comparison patched
parent:   NULL
body:     Antecedent: code-inspection — server/lib/briefing/filter-for-planner.js
          line 129 used naive string equality on un-normalized event-side
          dates; both sides now route through the same tz-aware formatter.
```

## If you see the DB NOTICE
Trigger fired because `parent_id` is NULL **and** body has no `Antecedent:` line. Either thread it (A), add the `Antecedent:` line (B), or accept the warning if you're certain the row is legitimately top-level.

## Why both layers exist
- **This skill** teaches the *judgment* — is the antecedent a memory row or external?
- **The DB trigger** (`migrations/20260429_claude_memory_antecedent_trigger.sql`) is a passive backstop — emits `RAISE NOTICE` when neither shape is present. Soft, doesn't block the insert.
