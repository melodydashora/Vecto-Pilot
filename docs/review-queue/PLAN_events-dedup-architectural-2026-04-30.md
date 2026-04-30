# PLAN: Events Dedup — Architectural Relocation (Read → Write)

**Status:** APPROVED 2026-04-30 — execution authorized by Melody after Course Correction (Choice B → Choice A).
**Date:** 2026-04-30
**Author (original):** Claude (sonnet-context preserving session) → handoff to fresh session for execution.
**Author (this revision):** Claude Opus 4.7 (1M context) — fresh session, post-audit + Melody course correction.
**Estimated effort:** ~2 hours of focused work in this session, with checkpoints.

---

## Course Correction Log — 2026-04-30

This plan was originally drafted as **Choice B (Composite Key)** — adding a new `UNIQUE (state, lower(title), event_start_date, venue_id)` partial index and switching the `ON CONFLICT` target to that key. The audit (run by this session before execution) revealed two facts the original framing missed:

1. **A `UNIQUE` constraint already exists** on `discovered_events.event_hash` (`shared/schema.js:614` + index at line 633), and the write path at `briefing-service.js:1485-1509` already does `onConflictDoUpdate({ target: discovered_events.event_hash })`. The plan's framing of "add a constraint" was wrong — a constraint exists; it's just keyed on a hash whose normalization doesn't match `deduplicateEvents()`'s normalization, which is why 184 dupes leaked through.
2. **Choice B has a fatal flaw** raised by Melody: `lower(title)` requires *exact* string match. `"Live Music: The Band"` and `"The Band"` are different lower-cased strings → composite-key constraint would NOT catch them. To make composite key catch them, you'd have to either (a) mangle the stored title in the DB (degrading UI), or (b) build a functional index that re-implements the JS normalization in SQL. Both unacceptable.

**Choice A (this plan) — keep `event_hash` as the canonical identity, upgrade its normalization to match `deduplicateEvents`.** This decouples *identity* (computed hash) from *presentation* (the stored title column). The hash function lives in JS and can evolve without schema migrations. The DB constraint is a structural backstop on the hash, not on raw column values.

The plan also bundles a fourth dedup site the original missed: `briefing-service.js:1610` (post-SELECT dedup inside `fetchEventsForBriefing`) is functionally a read-path call even though it lives in the briefing-service module — it must be stripped along with the three sites in `briefing.js`.

Audit-trail anchors: claude_memory rows 268–271 (architectural doctrine), the original Choice-B plan (commit `1f93b7db`), and this revision.

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

## Audit Findings (the facts that shaped Choice A)

### Finding 1 — `event_hash` constraint already exists

`shared/schema.js:614`:
```js
event_hash: text("event_hash").notNull().unique()  // MD5 of normalize(title)+venue_name+city+date
```
And the write path at `briefing-service.js:1485-1509`:
```js
.onConflictDoUpdate({
  target: discovered_events.event_hash,
  set: { ... full content fields update ... }
});
```

So the upsert behavior on hash collision is already correct: when the same event is re-discovered, fields update in place. The reason 184 dupes exist is the **normalization gap** between hash and dedup.

### Finding 2 — Normalization gap

`generateEventHash` (at `server/lib/events/pipeline/hashEvent.js`) and `deduplicateEvents` (at `briefing-service.js:174`) use different normalizations:

| Step | `generateEventHash` (DB constraint) | `deduplicateEvents` (app dedup) |
|---|---|---|
| Title cleaning | strip "at Venue" suffix; lowercase; remove special chars | strip prefixes ("live music:", "concert:"); strip parentheticals; strip "at/in/from/@" suffixes |
| Key components | title \| venue\_name \| city \| date | normalized\_title \| street\_name \| start\_time |
| Time | not in key | in key |
| Venue | venue\_name string | street name extracted from address |

Events that `deduplicateEvents` considers identical produce **different `event_hash` values** when titles carry extra prefixes/parentheticals/suffixes. Those bypass the DB constraint. The 184 overlap rows are the accumulated debt.

### Finding 3 — Dedup runs in 4 places, not 2

| # | Location | What runs |
|---|---|---|
| 1 | `briefing.js:938-949` | local events on `/events/:snapshotId` |
| 2 | `briefing.js:1075-1080` | market events on `/events/:snapshotId` |
| 3 | `briefing.js:461-464` | market events on aggregate `/snapshot/:snapshotId` (added 2026-04-18) |
| 4 | `briefing-service.js:1610` | events read inside `fetchEventsForBriefing` (post-SELECT batch) |

Site #4 is functionally read-path even though its module is "briefing-service" — it operates on SELECT-back results, not on the Gemini batch. The original plan missed it.

### Finding 4 — Pre-insert dedup doesn't currently happen

The original plan §148 said "Run `deduplicateEvents` on the Gemini batch BEFORE insert (already happens; verify)." Audit shows this is **false**. Today, events are inserted one-at-a-time via `onConflictDoUpdate(event_hash)` in a `for (const event of validatedEvents)` loop (`briefing-service.js:1356-1516`). `deduplicateEvents` only runs on the SELECT-back results in `fetchEventsForBriefing` (line 1610). So the work is to introduce a batch-mode dedup BEFORE the insert loop.

### Finding 5 — Dupe scope (dev DB, 2026-04-30)

Total `discovered_events` rows with `venue_id IS NOT NULL`: **1573**.
Unique by `(state, lower(title), event_start_date, venue_id)`: **1389**.
Overlap: **184 rows** (~12% noise).

Plus ~12 rows where `venue_id IS NULL` have 2-3x duplicates each ("sarper guven", "big jay oakerson", "mike ryan", "george lopez"). Choice A handles these naturally because the hash function uses `city` as a key component, so venue-less events can still be uniquely identified.

---

## Architecture (Choice A)

### Identity decoupled from presentation

The `event_hash` column is the **identity**: a deterministic function of the event's identifying attributes, computed at write time. The DB enforces uniqueness on the hash.

Stored fields like `title`, `venue_name`, `address` are **presentation**: untouched by the dedup logic, free to carry the original Gemini-returned strings (with all their flair — "Live Music: The Band Featuring So-and-So") for UI display.

When `generateEventHash` is updated, the hash function computes a new value over the same underlying event — but the stored title/venue/etc. remain pristine. This is why Choice A works without UI degradation.

### Late-binding evolution

Future variation patterns (a new prefix Gemini decides to use, a new parenthetical convention) can be handled by:
1. Updating the JS normalization in `hashEvent.js`
2. Re-running the migration script
3. No schema migration

The constraint stays put. The function evolves.

### Two-layer dedup at write time

1. **Hash layer (DB-enforced):** `event_hash` UNIQUE catches re-discoveries of the same event. Updated normalization closes the prefix/suffix/parenthetical gap.
2. **Semantic layer (application):** `deduplicateEventsSemantic` catches title-similarity / venue-plausibility cases the hash can't catch (e.g., "Fatboy Slim, Coco & Breezy" vs "Fatboy Slim", or correct vs wrong-stadium venue assignment). Runs PRE-INSERT on the Gemini batch.

The hash is a structural backstop; the semantic dedup is the smarter pre-filter. Both run at write time. Read path is pure SELECT.

---

## Objectives

1. **Update `generateEventHash`** to apply the same aggressive normalization as `deduplicateEvents` (strip prefixes, parentheticals, suffixes — see §1 below).
2. **Migrate existing 1573 rows** via a one-off Node script that recomputes hashes, consolidates dupes, and updates the surviving rows.
3. **Move dedup to PRE-INSERT** in the briefing pipeline: run `deduplicateEvents` + `deduplicateEventsSemantic` on the Gemini batch before the insert loop.
4. **Strip dedup from all 4 read-path sites** (3 in `briefing.js`, 1 in `briefing-service.js`).
5. **Audit & preserve** freshness/active filters — these are clock-dependent, legitimately read-time, and stay.
6. **Capture the doctrine** in `LESSONS_LEARNED.md` and `CLAUDE.md` (Choice A vs Choice B reasoning, late-binding identity principle).

---

## Approach (by phase)

### §1. Update `generateEventHash` + add unit tests (TDD)

**File:** `server/lib/events/pipeline/hashEvent.js`

**Current normalization** (lines 50-84):
- `stripVenueSuffix`: strips trailing " at Venue", " @ Venue", " - Venue"
- `normalizeForHash`: lowercase, strip quotes, remove special chars, collapse whitespace

**Add to `stripVenueSuffix` (or a new `stripPrefixesAndExtras` helper):**
- Strip prefixes: `^(live music|live band|concert|show|event|performance|dj set|acoustic):\s*`
- Strip parentheticals: `\s*\([^)]*\)\s*` (replace with single space, then collapse)

These match `briefing-service.js:189-193` (`normalizeEventName` in `deduplicateEvents`).

**Add address/street-name extraction (Melody nuance 2026-04-30):**

`deduplicateEvents` keys on `name|street_name|time`; the hash currently uses `title|venue_name|city|date`. To achieve full parity at the constraint level, `generateEventHash` should also include the **normalized street name** as a key component. Mirror `normalizeAddress` from `briefing-service.js:206-214`:

```js
function extractStreetName(address) {
  if (!address) return '';
  const lower = address.toLowerCase();
  // Get street name (after street number)
  const streetMatch = lower.match(/\d+\s+(.+?)(?:,|$)/);
  const streetName = streetMatch ? streetMatch[1].split(/[,#]/)[0].trim() : lower;
  // First few significant words
  return streetName.split(/\s+/).slice(0, 2).join(' ');
}
```

Updated `buildHashInput` composition: `title | venue_name | street_name | city | date`. Reasoning:
- Catches the case where Gemini returns the same event at "5776 Grandscape Blvd" and "5752 Grandscape Blvd" — both normalize to street name "grandscape blvd".
- Catches the case where venue_name varies slightly ("Cosm" vs "Cosm Shared Reality") but the physical street is stable — street_name converges.
- Adds a tie-breaker without altering the existing date/city dimensions of identity.

Add a test case: two events with same title/venue/city/date but addresses differing only by street number → SAME hash.

**Tests** (new file, location TBD — verify project test convention first):
```js
// tests/lib/events/pipeline/hashEvent.test.js (or .spec.js per project convention)

describe('generateEventHash', () => {
  it('produces same hash regardless of "Live Music:" prefix', () => {
    const a = { title: 'Live Music: The Band', venue_name: 'Billy Bob\'s', city: 'Fort Worth', event_start_date: '2026-05-01' };
    const b = { title: 'The Band', venue_name: 'Billy Bob\'s', city: 'Fort Worth', event_start_date: '2026-05-01' };
    expect(generateEventHash(a)).toBe(generateEventHash(b));
  });

  it('produces same hash for parenthetical variations', () => {
    const a = { title: '"O" by Cirque du Soleil (Shared Reality)', venue_name: 'Cosm', city: 'The Colony', event_start_date: '2026-05-01' };
    const b = { title: 'O by Cirque du Soleil', venue_name: 'Cosm', city: 'The Colony', event_start_date: '2026-05-01' };
    expect(generateEventHash(a)).toBe(generateEventHash(b));
  });

  it('produces same hash for "at Venue" suffix variants (existing behavior)', () => {
    const a = { title: 'Cirque du Soleil at Cosm', venue_name: 'Cosm', city: 'The Colony', event_start_date: '2026-05-01' };
    const b = { title: 'Cirque du Soleil', venue_name: 'Cosm', city: 'The Colony', event_start_date: '2026-05-01' };
    expect(generateEventHash(a)).toBe(generateEventHash(b));
  });

  it('different cities produce different hashes (existing behavior)', () => {
    const a = { title: 'Bruno Mars', venue_name: 'Fair Park', city: 'Dallas', event_start_date: '2026-05-01' };
    const b = { title: 'Bruno Mars', venue_name: 'Fair Park', city: 'Houston', event_start_date: '2026-05-01' };
    expect(generateEventHash(a)).not.toBe(generateEventHash(b));
  });

  it('different start times produce same hash (intentional — time is not in key)', () => {
    const a = { title: 'Bruno Mars', venue_name: 'AAC', city: 'Dallas', event_start_date: '2026-05-01', event_start_time: '7:00 PM' };
    const b = { title: 'Bruno Mars', venue_name: 'AAC', city: 'Dallas', event_start_date: '2026-05-01', event_start_time: '7:30 PM' };
    expect(generateEventHash(a)).toBe(generateEventHash(b));
  });

  it('special chars and whitespace differences collapse', () => {
    const a = { title: 'Spring Fling Event!', venue_name: 'Fair Park', city: 'Dallas', event_start_date: '2026-05-01' };
    const b = { title: 'Spring Fling   Event', venue_name: 'Fair Park', city: 'Dallas', event_start_date: '2026-05-01' };
    expect(generateEventHash(a)).toBe(generateEventHash(b));
  });
});
```

**TDD order:** write tests, run them red, update `hashEvent.js`, tests pass.

### §2. Migration script

**File:** `server/scripts/migrate-event-hashes.js`

**Behavior:**
1. Read all rows from `discovered_events` (no filter — venue-less rows included).
2. For each row, compute a NEW hash using the updated `generateEventHash` (imported from the same source the rest of the app uses).
3. Group rows by new hash.
4. For each group:
   - If size = 1 and old hash differs from new hash → UPDATE the row's `event_hash` field to new value.
   - If size > 1 → keep the OLDEST row (min `discovered_at`); **DELETE the duplicate rows FIRST, then UPDATE the survivor's hash** (see execution-order note below).
5. Log the consolidation: rows scanned, groups found, dupes deleted, hashes rewritten.

**Execution-order discipline (Melody nuance 2026-04-30):**

Within each duplicate group, the script MUST execute DELETE statements for the duplicate rows BEFORE issuing the UPDATE that changes the survivor's `event_hash` to the new value. Reasoning: in the rare case where the new hash for the survivor coincidentally collides with the OLD hash of one of the duplicates (or any other row in the table that happens to currently hold that hash value), an UPDATE-first ordering would violate `UNIQUE(event_hash)` and abort the migration mid-stream. DELETE-first removes all candidate collisions from the group before the UPDATE runs.

Recommended pattern:
```js
for (const [newHash, group] of groups) {
  if (group.length === 1) {
    if (group[0].event_hash !== newHash) {
      await db.update(...).set({ event_hash: newHash }).where(eq(id, group[0].id));
    }
    continue;
  }
  group.sort((a, b) => new Date(a.discovered_at) - new Date(b.discovered_at));
  const survivor = group[0];
  const dupeIds = group.slice(1).map(r => r.id);
  // STEP 1: DELETE duplicates first
  await db.delete(discovered_events).where(inArray(discovered_events.id, dupeIds));
  // STEP 2: ONLY THEN update survivor's hash if it changed
  if (survivor.event_hash !== newHash) {
    await db.update(discovered_events).set({ event_hash: newHash }).where(eq(id, survivor.id));
  }
}
```

**Why oldest-wins:** older rows have more downstream FK references already established (e.g., `ranking_candidates.event_id`). Deleting them would force FK churn. Keeping them = no churn.

**Pre-flight:** the script MUST run AFTER `pg_dump` of `discovered_events` (task #3). Backup goes to `/tmp/discovered_events_pre_dedup_2026-04-30.sql`. Restore command on failure: `\i /tmp/discovered_events_pre_dedup_2026-04-30.sql`.

**Run target:** dev DB only initially (Helium per Rule 13). Prod migration is a separate step gated on dev verification.

### §3. Move dedup to PRE-INSERT

**File:** `server/lib/briefing/briefing-service.js`

**Current** (line 1356-1516, simplified):
```js
for (const event of validatedEvents) {
  const hash = generateEventHash(event);
  // ... venue resolution ...
  await db.insert(discovered_events).values({...}).onConflictDoUpdate({...});
}
```

**New:**
```js
// Pre-INSERT dedup pass — the canonical write-time dedup
const hashDeduped = deduplicateEvents(validatedEvents);
const { deduplicated: semanticDeduped } = deduplicateEventsSemantic(hashDeduped);

console.log(
  `[BRIEFING] [EVENTS] [DEDUP] [WRITE] hash: ${validatedEvents.length} → ${hashDeduped.length}, ` +
  `semantic: ${hashDeduped.length} → ${semanticDeduped.length}`
);

for (const event of semanticDeduped) {
  const hash = generateEventHash(event);
  // ... venue resolution ...
  await db.insert(discovered_events).values({...}).onConflictDoUpdate({...});
}
```

The DB unique constraint on `event_hash` becomes a race-safety backstop, not the primary defense. Application-layer dedup is the primary defense, running on the deduped batch BEFORE the insert loop.

**Object-identity note (Melody nuance 2026-04-30):**

`deduplicateEventsSemantic` (at `server/lib/events/pipeline/deduplicateEventsSemantic.js:319-345`) operates by sorting groups and pushing the highest-scoring event back into the `deduplicated` array — it does NOT mutate event fields or strip properties. Each event in `semanticDeduped` is the same object reference that came in. So when the per-event loop calls `generateEventHash(event)`, the hash builder receives an event with all original properties (title, venue_name, address, city, event_start_date, event_start_time, etc.) intact. No field-shape concerns at the boundary.

### §4. Strip dedup from read paths (4 sites)

#### Site 1 — `briefing.js:938-949` (local events)

Remove:
```js
const beforeDedup = allEvents.length;
allEvents = deduplicateEvents(allEvents);

const beforeSemantic = allEvents.length;
const { deduplicated: semanticDeduped } = deduplicateEventsSemantic(allEvents);
allEvents = semanticDeduped;
if (beforeSemantic > allEvents.length) {
  console.log(`[BRIEFING] [EVENTS] [DEDUP] Semantic dedup: ${beforeSemantic} → ${allEvents.length} ...`);
}
```

Keep: `filterFreshEvents`, `filter === 'active'` branch.

#### Site 2 — `briefing.js:1075-1080` (market events at /events)

Remove:
```js
marketEvents = deduplicateEvents(marketEvents);
const { deduplicated: marketDeduped } = deduplicateEventsSemantic(marketEvents);
marketEvents = marketDeduped;
```

Keep: `filterFreshEvents(marketEvents, ...)`.

#### Site 3 — `briefing.js:461-464` (market events at /snapshot aggregate)

Remove:
```js
marketEvents = deduplicateEvents(marketEvents);
const { deduplicated: marketDeduped } = deduplicateEventsSemantic(marketEvents);
marketEvents = marketDeduped;
```

Keep: `filterFreshEvents(marketEvents, ...)`.

#### Site 4 — `briefing-service.js:1610` (post-SELECT inside fetchEventsForBriefing)

Remove:
```js
const deduplicatedEvents = deduplicateEvents(normalizedEvents);
const cleanEvents = filterInvalidEvents(deduplicatedEvents, { timezone });
```

Replace with:
```js
const cleanEvents = filterInvalidEvents(normalizedEvents, { timezone });
```

`filterInvalidEvents` stays — it removes TBD/Unknown rows, which is data-quality, not dedup.

**Shape-contract note (Melody nuance 2026-04-30):**

`normalizedEvents` at site #4 is the UI-mapped shape (title/summary/impact/event_type/subtype/event_start_date/event_start_time/event_end_time/event_end_date/address/venue/location/latitude/longitude/venue_id). Today, `deduplicateEvents` preserves this shape (it returns the same UI objects, just deduped), and `filterInvalidEvents` already accepts this shape (it delegates to `validateEventsHard` with the same input the rest of the pipeline uses). Removing the dedup pass between them does NOT change the contract — `filterInvalidEvents` continues to receive the same UI-mapped shape it accepts today, just without an intermediate dedup step. **Verification step during execution:** confirm by reading `validateEvent.js`'s `validateEventsHard` to ensure it doesn't depend on a property that `deduplicateEvents` was somehow injecting (it doesn't, but verify before the strip lands).

#### Imports cleanup

After all four sites are stripped, audit imports:
- `briefing.js:4`: `deduplicateEvents` may no longer be used → remove from import.
- `briefing.js:6`: `deduplicateEventsSemantic` may no longer be used → remove from import.
- `briefing-service.js:24`: `deduplicateEventsSemantic` IS still used (now at pre-INSERT) → keep.
- `briefing-service.js`: `deduplicateEvents` is defined locally (line 174) and still used (now at pre-INSERT) → keep.

### §5. Logs after the move

**During briefing pipeline (write):**
```
[BRIEFING] [EVENTS] [DEDUP] [WRITE] hash: 16 → 14, semantic: 14 → 13
[BRIEFING] [EVENTS] [DB] [discovered_events] [INSERT] 13 events written
```

**During GET `/events/:snapshotId` (read):**
```
[BRIEFING] [API] [EVENTS] GET /events: today=..., endDate=..., tz=...
[BRIEFING] [API] [EVENTS] [READ] 41 events returned
```

NO `[DEDUP]` lines under `[BRIEFING] [API]`. That chain becomes structurally impossible.

### §6. Freshness/active filter audit

Both filters depend on **request time** (`new Date()`), so they're legitimately read-time concerns under the taxonomy. They don't need to move. Specifically:

- `filterFreshEvents` — checks `event_end_date < today` in snapshot timezone. Stays.
- `isEventActiveNow` — checks `event_start_time <= now <= event_end_time` in venue timezone. Stays.

Both pass `snapshotTz`/venue tz; both are stage-correct as read-time clock-dependent filters.

---

## Files Affected

**Hash function + tests:**
- `server/lib/events/pipeline/hashEvent.js` (modify normalization)
- `tests/lib/events/pipeline/hashEvent.test.js` (new — verify project test convention first)

**Migration:**
- `server/scripts/migrate-event-hashes.js` (new)

**Write path:**
- `server/lib/briefing/briefing-service.js` (insert pre-INSERT dedup pass; strip post-SELECT call at line 1610)

**Read path:**
- `server/api/briefing/briefing.js` (strip 3 dedup callsites; clean up imports)

**Documentation:**
- `CLAUDE.md` — add a doctrine note: "events dedup is write-time; identity (hash) is decoupled from presentation (title)"
- `LESSONS_LEARNED.md` — capture: "late-binding identity via computed hash beats early-binding via composite key when normalization needs to evolve"
- `docs/EVENTS.md` — update read/write contract diagram (if it exists; verify before editing)
- `docs/review-queue/PLAN_events-dedup-architectural-2026-04-30.md` — this file (Course Correction Log added at top)

---

## Test Cases (Rule 1 — must pass before declaring complete)

Each test must pass before declaring this complete. Melody test-approves before merge.

### TC-1: Hash unit tests (TDD)

Per §1 above. All assertions in `hashEvent.test.js` pass green.

### TC-2: Migration correctness

- Before migration: `SELECT lower(title), event_start_date, venue_id, COUNT(*) FROM discovered_events GROUP BY 1,2,3 HAVING COUNT(*) > 1;` returns the 184 dupes from §Audit Findings.
- Run migration script.
- After migration: same query returns 0 (all consolidated).
- Spot-check: pick 3 dupe groups from before; verify only oldest survives; verify `event_hash` value matches new normalization.

### TC-3: Idempotency at write

- Run briefing pipeline for a snapshot. Note the inserted-event count from the `[BRIEFING] [EVENTS] [DEDUP] [WRITE]` log.
- Trigger another briefing for same snapshot (or same Gemini batch). Verify second run inserts 0 NEW rows; only field updates on conflict.
- Verify with: `SELECT COUNT(*) FROM discovered_events WHERE created_at > NOW() - INTERVAL '5 minutes';`.

### TC-4: Read-path purity

- Reload `/co-pilot/strategy` in browser. Trigger /events GET multiple times. Trigger /snapshot GET (aggregate).
- Server console MUST NOT show:
  - `[BRIEFING] [API] [EVENTS] [DEDUP]`
  - `[BRIEFING] [EVENTS] [DEDUP]` from any read path
- Server console MUST show:
  - `[BRIEFING] [API] [EVENTS] GET` (read still happens)
  - `[BRIEFING] [EVENTS] [DEDUP] [WRITE]` only during briefing generation

### TC-5: Behavior preservation

- Before fix: `/events/{snapshotId}` returns N events for snapshot X.
- After fix: same call returns N events for snapshot X (same data, same shape, same count).
- `?filter=active` returns same subset before/after.
- `/snapshot/{snapshotId}` aggregate returns same `marketEvents` count before/after.

### TC-6: No regression in write path

- Briefing pipeline still completes with `[BRIEFING] COMPLETE` log.
- Strategy and venue planner still receive event data.
- Map markers still render with same events.
- No test users see "events generation failed" sentinels.

### TC-7: Constraint enforcement

- Manually attempt to insert a duplicate row via psql:
  ```sql
  INSERT INTO discovered_events (title, venue_name, city, state, event_start_date, event_end_time, event_hash, ...)
  VALUES (...same values as an existing row that produces the same hash...);
  ```
- Expect: `duplicate key value violates unique constraint "..."`

### TC-8: Foreign key integrity

- After migration: `SELECT COUNT(*) FROM ranking_candidates rc WHERE rc.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM discovered_events de WHERE de.id = rc.event_id);` — expect 0.
- Same check for any other FK referencing `discovered_events.id`.

---

## Rollback Strategy

### Migration rollback

The DELETE in §2 is irreversible without backup. Mandatory `pg_dump` BEFORE migration (task #3). On failure:
```bash
psql "$DATABASE_URL" -c "TRUNCATE discovered_events CASCADE;"  # Wipes the (now-broken) state
psql "$DATABASE_URL" < /tmp/discovered_events_pre_dedup_2026-04-30.sql  # Restore
```

### Code rollback

All commits are discrete and per-step:
1. Hash function update + tests (single commit)
2. Migration script + dry-run results (single commit; migration run is a separate operational step, not a commit)
3. Pre-INSERT dedup move in briefing-service.js (single commit)
4. Read-path strip across 4 sites (single commit)
5. Doctrine doc updates (single commit)

`git revert <commit>` per step.

### Behavior fallback

If the read-path strip causes UI regression: revert step 4. Read path resumes app-layer dedup; the DB constraint + write-path dedup remain. Defense in depth re-engaged.

---

## Order of Execution

1. ✓ Read this plan in full.
2. ✓ Read claude_memory rows 268–271 (architectural doctrine).
3. ✓ Run pre-work audit. Confirm assumptions.
4. ✓ Pause + surface findings to Melody. Get Course Correction approval.
5. ✓ Rewrite this plan doc to reflect Choice A. **Push to git.** ← *current step*
6. Update `generateEventHash` per §1 (TDD: tests first, red, update, green).
7. `pg_dump` backup of `discovered_events` to `/tmp/discovered_events_pre_dedup_2026-04-30.sql`.
8. Write migration script per §2. Dry-run (count-only) first; print the consolidation plan; confirm with Melody before destructive run.
9. Run migration on dev DB. Verify per TC-2.
10. Move dedup to PRE-INSERT per §3. Trigger a briefing pipeline test.
11. Strip read path per §4 (4 sites). Reload UI. Verify console per TC-4.
12. Run all 8 test cases (TC-1 through TC-8).
13. Surface results to Melody. Get test approval.
14. Commit per-step. Push.
15. Mark task #10 complete.

---

## Status

**APPROVED 2026-04-30. Course-Correction-applied. Execution in progress.**

**Companion claude_memory rows** (status=active):
- **268** — Taxonomy is a stage specification, not a logging style
- **269** — Workarounds for stage-placement violations entrench drift
- **270** — Plan-then-fresh-session protocol for substantial architectural work
- **271** — Melody's collaboration contract with Claude (2026-04-30 articulation)

Read these first in any subsequent session via:
```
psql "$DATABASE_URL" -tAc "SELECT content FROM claude_memory WHERE id IN (268,269,270,271) ORDER BY id;"
```

They encode the doctrine driving this plan. The implementation steps in §1–§4 are mechanical; the doctrine in those rows is what makes the difference between "did the refactor" and "did it correctly."

---

## Decision Log

| Date | Decision | Rationale | Author |
|------|----------|-----------|--------|
| 2026-04-30 | Reject Choice B (composite key) | `lower(title)` exact-match would force title-mangling to catch prefix variations, degrading UI | Melody |
| 2026-04-30 | Adopt Choice A (refined hash) | Late-binding identity decouples hash from stored title; normalization can evolve without schema migrations | Melody (with Claude concurrence after audit) |
| 2026-04-30 | Bundle site #4 (briefing-service.js:1610) | Goal is a lean, pure-SELECT read path; leaving #4 defeats the architecture by keeping computation in a layer that should only retrieve | Melody |
| 2026-04-30 | Clean up venue-less event dupes | Choice A's hash naturally handles them via city fallback; intelligence-only events shouldn't be exempt from data integrity | Melody |
| 2026-04-30 | JS migration script (not SQL PL/pgSQL) | Imports the same `generateEventHash` the app uses → guaranteed parity. SQL re-implementation would create drift risk | Claude (concurrence after Melody push-back) |
