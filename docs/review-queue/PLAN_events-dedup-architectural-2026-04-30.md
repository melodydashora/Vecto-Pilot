# PLAN: Events Dedup — Architectural Relocation (Read → Write)

**Status:** DRAFT — awaiting Melody approval before any code execution.
**Date:** 2026-04-30
**Author:** Claude (sonnet-context preserving session) → handoff to fresh session for execution.
**Estimated effort:** ~2 hours of focused work in a fresh session.

---

## Why This Plan Exists

Per Melody's 2026-04-30 directive: the workflow chain log taxonomy isn't a logging-readability nicety — it's a **specification** for where operations belong in the system's ordered waterfall. The column order

```
[App Category] [Connection] [Action] [LLM Name] [LLM Connection] [Retrieved Secondary] [System] [Table Name] [File/Function]
```

encodes a contract: each `[Action]` belongs at a specific waterfall stage. A log line showing an Action at the wrong stage is **evidence of an architectural placement bug, not inefficiency**.

The current `/api/briefing/events/:snapshotId` GET handler emits this chain on every call:

```
[BRIEFING] [API] [EVENTS] [DEDUP] Hash dedup: 45 → 41
[BRIEFING] [EVENTS] [DEDUP] Merged 2 variants → kept "..."  (×9)
[BRIEFING] [EVENTS] [DEDUP] Semantic dedup: 41 → 33
[BRIEFING] [EVENTS] [FRESHNESS] Filtered: 6 stale, kept 27/33
[BRIEFING] [EVENTS] [FILTER] Active: 13/27
```

…repeating ~15× after `[VENUE] COMPLETE` per page load.

Under the taxonomy: `[BRIEFING] [API] [EVENTS] [DEDUP]` is **impossible** in a correctly-staged system. DEDUP belongs at write (when events first enter `discovered_events`). The fact that this chain exists at API serve time is the bug.

**Workaround temptation (rejected):** server-side memoization (30s TTL) would suppress the log noise while keeping the violation in place. Per claude_memory doctrine — "workarounds for stage-placement violations entrench drift" — this is not the right fix.

**This plan: relocate the operation, not hide the symptom.**

---

## Objectives

1. **Move all event deduplication from the READ path to the WRITE path.** When a new batch of Gemini-discovered events is being inserted into `discovered_events`, dedup runs there. The READ path becomes a pure SELECT + map + return.
2. **Add a database-level unique constraint** that makes hash-level duplicates structurally impossible going forward. The DB enforces invariant; application logic doesn't have to defend it on every read.
3. **One-time migration to consolidate existing duplicates** in `discovered_events` (the 4 hash-dupes and 8 title-variants visible in the read-path logs are accumulated debt).
4. **Strip dedup from the read path entirely.** No `deduplicateEvents()` or `deduplicateEventsSemantic()` calls in `briefing.js` GET handler. The read path becomes:

   ```js
   const events = await db.select(...).from(discovered_events).where(...);
   const allEvents = events.map(transformShape);
   const fresh = filterFreshEvents(allEvents, ...);  // see §6 below
   if (filter === 'active') fresh = fresh.filter(isEventActiveNow, ...);
   res.json({ success: true, events: fresh, ... });
   ```

5. **Audit freshness/active filters** — confirm these are clock-dependent (legitimately read-time) and not also stage-misplaced.

---

## Pre-Work Audit (do this FIRST in the new session)

Before touching code:

1. **Find every write path into `discovered_events`.** Likely just `briefing-service.js`, but verify with:
   ```bash
   grep -rn "discovered_events" --include="*.js" server/ | grep -E "insert|upsert|onConflict" | grep -v node_modules | grep -v dist
   ```
   Expected: 1-2 hot paths in `briefing-service.js` (Gemini discovery insert; possibly also a Places-resolution upsert). Document each.

2. **Inspect current dedup logic in detail:**
   - `deduplicateEvents` at `server/lib/briefing/briefing-service.js:269` (hash-based)
   - `deduplicateEventsSemantic` at `server/lib/events/pipeline/deduplicateEventsSemantic.js` (title-similarity)
   - Read both fully. Understand the hash key (probably title+venue+date) and the similarity threshold.

3. **Inspect current `discovered_events` schema:**
   - `shared/schema.js` — find the `discovered_events` table definition
   - Note existing indexes
   - Identify natural unique columns: probably `(state, lower(title), event_start_date, venue_id)` — but verify against actual hash logic in `deduplicateEvents`

4. **Count existing duplicates in dev DB:**
   ```sql
   SELECT lower(title), event_start_date, venue_id, COUNT(*) as dupe_count
   FROM discovered_events
   GROUP BY lower(title), event_start_date, venue_id
   HAVING COUNT(*) > 1
   ORDER BY dupe_count DESC
   LIMIT 50;
   ```
   This is the migration scope. Expect 10s-100s of dupes.

5. **Find all consumers of `discovered_events` (READ side):**
   ```bash
   grep -rn "from(discovered_events)" --include="*.js" server/ | grep -v node_modules | grep -v dist
   ```
   Each consumer must be confirmed to expect already-deduped data. If any consumer relies on raw rows + their own dedup, refactor those too.

---

## Approach (after audit)

### §1. Schema Migration

Create `migrations/20260430_discovered_events_dedup_constraint.sql`:

```sql
-- Step 1: Identify and consolidate existing duplicates BEFORE adding constraint
-- (otherwise the ALTER TABLE will fail on existing rows)

-- Strategy: keep the oldest row (by created_at) per dupe group, delete newer dupes.
-- Reason: older rows likely have more downstream FK references already established.
-- Alternative considered: keep newest row. Rejected because it would require updating
-- every FK in ranking_candidates / briefings / etc. Keeping oldest = no FK churn.

WITH dupe_groups AS (
  SELECT
    id,
    state,
    lower(title) AS title_lc,
    event_start_date,
    venue_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY state, lower(title), event_start_date, venue_id
      ORDER BY created_at ASC
    ) AS row_num
  FROM discovered_events
  WHERE venue_id IS NOT NULL  -- skip orphans (separate problem)
)
DELETE FROM discovered_events
WHERE id IN (
  SELECT id FROM dupe_groups WHERE row_num > 1
);

-- Step 2: Add unique constraint
-- Composite key matches the hash-dedup logic in deduplicateEvents()
CREATE UNIQUE INDEX IF NOT EXISTS uq_discovered_events_hash
  ON discovered_events (state, lower(title), event_start_date, venue_id)
  WHERE venue_id IS NOT NULL AND is_active = true;

-- Note: PARTIAL index — only on active rows with venue_id. Soft-deleted (is_active=false)
-- rows can carry "duplicate" entries because they're not in the served set.
```

**Open questions for the new session:**
- Verify the composite key matches `deduplicateEvents()` hash logic exactly. If they differ, the constraint won't catch what the application currently catches. Audit before writing migration.
- Decide on partial-index predicate: include `is_active = true`? Or all rows? Trade-off: full index is stricter; partial index allows deactivated dupes.
- Title similarity (the `Semantic dedup` step) is NOT a DB constraint — it's still application logic. The constraint catches the easy case; semantic dedup runs at write time as a second pass.

### §2. Write-Path Changes

In `server/lib/briefing/briefing-service.js`, the events insert path needs to:

1. Run `deduplicateEvents()` on the Gemini batch BEFORE insert (already happens; verify).
2. Run `deduplicateEventsSemantic()` on the dedup'd batch (already happens; verify).
3. Insert with `ON CONFLICT (state, lower(title), event_start_date, venue_id) DO NOTHING` to be safe in case of races.
4. Log `[BRIEFING] [EVENTS] [DEDUP] [WRITE]` with merged-variant counts. The log lines are NOT removed — they just move to the right stage.

### §3. Read-Path Cleanup

In `server/api/briefing/briefing.js` GET `/events/:snapshotId` handler (line 830-1111):

**Remove:**
- Line 938-939: `const beforeDedup = allEvents.length; allEvents = deduplicateEvents(allEvents);`
- Line 944-949: `deduplicateEventsSemantic` call + log
- Line 1075-1079: market-events dedup pipeline (also moves to write)

**Keep:**
- Freshness filter (clock-dependent, legitimately read-time — see §6)
- Active filter (clock-dependent — same)
- Map to response shape
- DB query

**Update imports:** drop `deduplicateEvents`, `deduplicateEventsSemantic` if no longer used in this file.

### §4. Other Consumers

For every other reader of `discovered_events` found in pre-work audit:
- If they currently call `deduplicateEvents()` themselves: remove the call (DB invariant now guarantees uniqueness).
- If they don't dedup: no change needed.

### §5. Logs After the Move

**Expected console output AFTER this fix:**

During briefing pipeline (write):
```
[BRIEFING] [EVENTS] [DEDUP] Hash dedup: 16 → 14 (2 duplicates removed)
[BRIEFING] [EVENTS] [DEDUP] Semantic dedup: 14 → 13 (1 title-variant)
[BRIEFING] [EVENTS] [DB] [discovered_events] [INSERT] 13 events written
```

During GET `/events/:snapshotId` (read):
```
[BRIEFING] [API] [EVENTS] GET /events: today=...
[BRIEFING] [API] [EVENTS] [READ] 41 events returned
```

(Note: NO `[DEDUP]` lines under `[BRIEFING] [API]` — that chain is now structurally impossible.)

### §6. Freshness/Active Filter Audit

Both filters depend on **request time** (`new Date()`), so they're legitimately read-time concerns under the taxonomy. They don't need to move. However, verify they're not doing extra work that should also relocate:

- `filterFreshEvents` — checks `event_end_date < today`. Could move to a partial-index filter `WHERE is_active = true AND event_end_date >= CURRENT_DATE`, but only if we accept that "today" comparison happens server-side without timezone awareness (currently passes `snapshotTz`). Recommend: leave as application logic for now since it needs timezone.
- `isEventActiveNow` — checks `event_start_time <= now <= event_end_time` in venue timezone. Inherently read-time. Stay.

### §7. Test Cases (per Rule 1)

Each test must pass before declaring this complete. Melody test-approves before commit.

1. **Idempotency:**
   - Run briefing pipeline twice for the same snapshot. Second run inserts 0 new events (all dupes caught at constraint).
   - Verify with: `SELECT COUNT(*) FROM discovered_events WHERE created_at > NOW() - INTERVAL '5 minutes';`

2. **Migration correctness:**
   - Before migration: count duplicates (per audit query).
   - Run migration.
   - After migration: same query returns 0.
   - Spot-check: pick 3 dupe groups from before, verify only oldest survives.

3. **Read path purity:**
   - Reload `/co-pilot/strategy` in browser. Trigger /events GET multiple times.
   - Console must NOT show `[BRIEFING] [API] [EVENTS] [DEDUP]` chain at any point.
   - Console MUST show `[BRIEFING] [API] [EVENTS] GET` lines (read still happens).

4. **Behavior preservation:**
   - Before fix: `/events/{snapshotId}` returns N events for snapshot X.
   - After fix: same call returns N events for snapshot X (same data, same shape, same count).
   - `?filter=active` returns same subset before/after.

5. **No regression in write path:**
   - Briefing pipeline still completes with `[BRIEFING] COMPLETE` log.
   - Strategy and venue planner still receive event data.
   - Map markers still render with same events.

6. **Constraint enforcement:**
   - Manually attempt to insert a duplicate row via psql:
     ```sql
     INSERT INTO discovered_events (...) VALUES (...);  -- known dupe values
     ```
   - Expect: `duplicate key value violates unique constraint`.

7. **Foreign key integrity:**
   - After migration, verify no orphaned references in `ranking_candidates`, `briefings`, etc.
   - `SELECT COUNT(*) FROM ranking_candidates rc WHERE rc.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM discovered_events de WHERE de.id = rc.event_id);` — expect 0.

---

## Files Affected

**Schema / migration:**
- `migrations/20260430_discovered_events_dedup_constraint.sql` (new)
- `shared/schema.js` (add unique index annotation if Drizzle wants it explicit)

**Write path:**
- `server/lib/briefing/briefing-service.js` (verify dedup-before-insert; add ON CONFLICT)

**Read path:**
- `server/api/briefing/briefing.js` (strip lines 938-939, 944-949, 1075-1079)

**Possibly:**
- `server/lib/events/pipeline/deduplicateEventsSemantic.js` (no change expected — moves where it's called, not the function itself)

**Documentation:**
- `CLAUDE.md` (Rule 11 / Rule 14 family — note the dedup-at-write doctrine in the EVENTS pipeline section)
- `LESSONS_LEARNED.md` (capture: "dedup at write, never at read" as a doctrine line)
- `docs/EVENTS.md` if exists (update read/write contract diagram)

---

## Rollback Strategy

If something goes sideways post-deploy:

1. **Migration rollback:**
   ```sql
   DROP INDEX IF EXISTS uq_discovered_events_hash;
   ```
   The `DELETE` from migration §1 is irreversible without a backup, so:
   - Take a `pg_dump` of `discovered_events` BEFORE running the migration.
   - Save dump to `/tmp/discovered_events_pre_dedup_2026-04-30.sql`.
   - On failure, restore via `\i /tmp/discovered_events_pre_dedup_2026-04-30.sql`.

2. **Code rollback:**
   - All commits should be discrete and per-step (migration in one, write-path change in another, read-path strip in a third). `git revert <commit>` per step.

3. **Behavior fallback:**
   - Read path can temporarily re-add the dedup pipeline if needed — it's idempotent against itself.

---

## Order of Execution (in fresh session)

The new session should execute in this order:

1. Read this plan in full.
2. Read claude_memory rows tagged `taxonomy` and `events-dedup` (they encode the doctrine driving this plan).
3. Run the pre-work audit (§Pre-Work Audit). Confirm assumptions.
4. **Pause here** — surface findings to Melody. Confirm constraint composition. Get approval.
5. Take `pg_dump` backup of `discovered_events`.
6. Write the migration file. Apply to dev DB only.
7. Verify migration: dupes consolidated, constraint added.
8. Update write path. Run a briefing pipeline test (force a snapshot rotation).
9. Strip read path. Reload UI. Verify console.
10. Run all 7 test cases.
11. Surface results to Melody. Get test approval.
12. Commit per-step. Push.
13. Mark task #10 complete.

---

## Status

**DRAFT — awaiting Melody approval.**

When the new session opens:
- Check this file's status line first.
- If still "DRAFT": do not execute. Confirm with Melody.
- If updated to "APPROVED — date stamp": proceed per Order of Execution.

**Companion claude_memory rows** (inserted 2026-04-30, all status=active):
- **268** — Taxonomy is a stage specification, not a logging style
- **269** — Workarounds for stage-placement violations entrench drift
- **270** — Plan-then-fresh-session protocol for substantial architectural work
- **271** — Melody's collaboration contract with Claude (2026-04-30 articulation)

Read these first in the new session via:
```
psql "$DATABASE_URL" -tAc "SELECT content FROM claude_memory WHERE id IN (268,269,270,271) ORDER BY id;"
```

They encode the doctrine driving this plan. The migration steps in §1-§7 are mechanical; the doctrine in those rows is what makes the difference between "did the refactor" and "did it correctly."
