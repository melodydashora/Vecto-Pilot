# Plan: Events Pipeline Verification + `[NEW EVENTS PIPELINE]` Tagging

**Date:** 2026-04-28
**Branch:** `coach-pass2-phase-b`
**Status:** REV-1 — incorporates Melody's 2026-04-28 review (P3 deferred, venue gate amended, tag scope narrowed, Option B locked, pre-edit predicate-quote required)
**Spec source:** Engineering Specification: Events Pipeline, Planner Contract, and Hardening Roadmap (12 sections, supplied by Melody 2026-04-28)
**Doctrine source:** `docs/EVENTS.md` (2026-04-11), `.code_based_rules/.rules_do_not_change/Up to Venue console wish.txt`, claude_memory rows #229 / #248 / #250

---

## Decisions locked from REV-0 review

| Decision | Locked value | Reason |
|----------|--------------|--------|
| P1 (multi-day, validateEvent timezone, orphan telemetry) | **APPROVE** | Real correctness/integrity gaps backed by repo evidence |
| P2 (planner-grade gate, "Places (NEW) API" wording) | **APPROVE w/ amendment** | Gate must classify-and-log incomplete venues into planner-ready / orphan / re-resolve buckets, not silently filter |
| P3 (deterministic event score, matcher telemetry rewrite) | **DEFER → separate plan** | Product-ranking doctrine, not pipeline hygiene; risks reintroducing the 40-mile / event-venue-primary logic that was already reverted |
| P4 (doc updates, tag insertion) | **APPROVE w/ narrowed scope** | Tag canonical checkpoints + new hardening telemetry only — not every historical log line |
| Tag format | **Option B** — `[Parent] [Sub] [...] [NEW EVENTS PIPELINE] — why` | Preserves canonical chain doctrine (memory #248); existing `grep '\[BRIEFING\]'` tooling still works |
| Tag scope | Narrowed (b): canonical checkpoints + new hardening telemetry; **not** a repo-wide log restyle | Avoids large-churn PR that obscures real logic changes |
| Pre-edit gate for `briefing-service.js:1542-1551` | **REQUIRED** — quote exact current predicate in PR/review before editing | Site verified by reading at start of session; quote retained in this plan §3 below for grounding |
| Desperation/bottleneck logic | **NOT in discovery** — stays in selection/ranking layer (future P3 plan) | Discovery builds the trustworthy today-working-set; selection decides what to surface |

This plan now covers **P1 + P2 only**. P3 will be drafted as `PLAN_events-pre-llm-scoring-YYYY-MM-DD.md` after P1/P2 land.

---

## Relationship to other in-flight work

| Plan | Coverage | Overlap with this plan |
|------|----------|------------------------|
| `docs/architecture/audits/duplicate-functions-fix-plan-2026-04-28.md` | Briefing-pipeline duplicate logs (Group A done in `8b8d4673` + `11522b67`); Groups B–E pending | Group B.1 (worker-side `updatePhase('venues')` in `enhanced-smart-blocks.js:361`) and Group C (7-route inline filter idiom in `briefing.js`) touch the same files this plan touches. **This plan does not redo those items.** Run them first or interleave commits. |
| `docs/EVENTS.md` (2026-04-11) | Authoritative pipeline doctrine | This plan lifts code into stronger compliance with EVENTS.md and identifies where EVENTS.md prose drifts from doctrine (e.g., "Places API" wording per app.MD edit #13). |
| `EVENT_FRESHNESS_AND_TTL.md` (2026-04-18 rewrite) | Per-snapshot deactivation + filter freshness | Already accurate post-2026-04-18 rewrite. No changes here. |

---

## 1. Compliance matrix (12-section spec → file:line evidence)

✅ = compliant · ⚠️ = partial / has gap · ❌ = missing

| Spec § | Topic | Evidence | Status |
|--------|-------|----------|--------|
| §3.1 Planner contract | Today's events + canonical venue + distance + traffic/weather/airport/closures | `enhanced-smart-blocks.js:381-398` | ✅ |
| §3.2 Pipeline contract | `discovered_events` as today working set under upstream guarantees | `briefing-service.js:1300-1305` deactivate + `:1453-1494` write + `:1542-1551` read | ⚠️ multi-day query bug |
| §3.3 Canonical venue contract | venue_catalog as identity layer | `briefing-service.js:1369-1411` + `enhanced-smart-blocks.js:179-213` LEFT JOIN | ✅ |
| §4.1 Trigger | blocks-fast → briefing → discovery | `briefing-service.js:1286 fetchEventsForBriefing` | ✅ |
| §4.2 Discovery | Gemini names + Google Places (NEW) for venue identity | `briefing-service.js:1056-1168` | ✅ |
| §4.3 Normalize → validate → dedup | ETL phases | `:1337-1147` (semantic dedup at write merge) | ✅ |
| §4.4 Venue resolution + validation gate | place_id cache → Places (NEW) → geocode + maybeReResolveAddress | `:1356-1411` + `venue-cache.js maybeReResolveAddress` + `:1438-1450` | ✅ |
| §4.5 Persistence | event_hash + onConflictDoUpdate using resolved venue truth | `:1453-1494` (post-2026-04-11 fix) | ✅ |
| §4.6 Freshness | deactivate (multi-day correct) + filterFreshEvents | `cleanup-events.js:23-58` + `strategy-utils.js filterFreshEvents` | ⚠️ deactivation correct, **selection queries are not** |
| §4.7 Briefing assembly | Parallel weather/traffic/events/airport/news/closures | `briefing-service.js generateAndStoreBriefing` | ✅ |
| §4.8 Strategist/planner split | Strategist reads frozen `briefings.events`; planner uses live join | `consolidator.js` + `enhanced-smart-blocks.js` (per `EVENTS.md §10`) | ✅ |
| §4.9 Smart Blocks fetch | State-scoped + venue_catalog join + distance annotation + closest-first | `enhanced-smart-blocks.js:169-254 fetchTodayDiscoveredEventsWithVenue` | ⚠️ multi-day bug, line 211 |
| §4.10 Planner input | filterBriefingForPlanner with pre-fetched events | `filter-for-planner.js:215-235` | ⚠️ legacy fallback at lines 110-140 — verify-then-delete (out of this plan) |
| §4.11 Matching | place_id → venue_id → name fallback | `event-matcher.js:138-182` (rewrote 2026-04-11 — structurally correct) | ✅ |
| §5.3 Planner-grade venue gate | place_id + formatted_address + city + state + lat + lng + timezone before planner | Implicit only via `haversineMiles` returning `Infinity` for null coords (silent drop) | ❌ → **G2.1 in this plan** |
| §5.4 Orphan event classification | planner-ready / briefing-only / re-resolve / orphaned | None — orphans silently fall out | ⚠️ partial → **G2.1 telemetry in this plan**; full taxonomy out of scope |
| §5.5 Read-path is_active enforcement | Every read filters `is_active = true` | `:1545` ✅, `briefing.js` 7 routes (Group C in fix-plan-2026-04-28) | ⚠️ scattered (out of this plan) |
| §5.7 Planner ranking | Deterministic pre-LLM event score | NEAR/FAR sort exists; no scoring function | ❌ → **deferred to separate plan** |
| §5.8 Matcher telemetry | Visible counts for match outcomes | `event-matcher.js:166` debug-only | ⚠️ → **deferred to separate plan with P3** |
| §6 Strategist NEAR/FAR annotation | distance_mi + estimated_attendance + [NEAR/FAR] tagging | `consolidator.js` per `EVENTS.md §10.5` | ✅ |
| §9.2 Locale: today-check uses snapshot timezone | server UTC vs snapshot.timezone | `validateEvent.js:149-150` UTC-only | ❌ → **G1.2 in this plan** |

---

## 2. Pre-edit predicate quotes (per Melody's review requirement)

These are the exact current predicates that this plan modifies. Quoted verbatim from the repo at session start; any drift between this quote and the file at edit-time MUST be flagged before the edit.

### Site A — `server/lib/briefing/briefing-service.js:1538-1551`
```javascript
const events = await db.select({
  // [...field projection elided — unchanged...]
})
  .from(discovered_events)
  .leftJoin(venue_catalog, eq(discovered_events.venue_id, venue_catalog.venue_id))
  // 2026-04-10: FIX — Query by STATE (metro-wide), not city. Events now store their
  // actual venue city (e.g., "Fort Worth", "Arlington") so filtering by snapshot city
  // ("Dallas") would miss all metro events outside the driver's exact city.
  .where(and(
    eq(discovered_events.state, state),
    gte(discovered_events.event_start_date, todayStr),       // ← BUG: forward-only on START date
    lte(discovered_events.event_start_date, endDateStr),     // ← BUG: forward-only on START date
    eq(discovered_events.is_active, true),
    // STRICT FILTER: Hide events with NULL times from UI
    isNotNull(discovered_events.event_start_time),
    isNotNull(discovered_events.event_end_time)
  ))
  .orderBy(discovered_events.event_start_date)
  .limit(50);
```

### Site B — `server/lib/venue/enhanced-smart-blocks.js:209-213`
```javascript
.where(and(
  eq(discovered_events.state, state),
  eq(discovered_events.event_start_date, eventDate),         // ← BUG: exact-equality on START date
  eq(discovered_events.is_active, true)
));
```

### Site C — `server/lib/events/pipeline/validateEvent.js:147-153`
```javascript
// Rule 13: Date must be today or yesterday (for late-night events past midnight)
// 2026-02-26: We only ask Gemini for today's events. Future-dated events are noise.
// Allow yesterday to handle events discovered before midnight that end after midnight.
const today = new Date().toISOString().split('T')[0];        // ← BUG: server UTC, not snapshot tz
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
if (event.event_start_date !== today && event.event_start_date !== yesterday) {
  return { valid: false, reason: 'not_today', field: 'event_start_date' };
}
```

---

## 3. Gap list (P1 + P2 in this plan)

### P1 — `discovered_events` working-set integrity

#### G1.1 Multi-day event query bug (Sites A + B)

**Site A — `briefing-service.js:1542-1544`**: forward 7-day window keyed on START date silently excludes events that started before today.

**Site B — `enhanced-smart-blocks.js:211`**: exact-match on START date misses any multi-day event whose first day was yesterday or earlier.

**Proposed change (Site A, briefing read with horizon):**
```javascript
.where(and(
  eq(discovered_events.state, state),
  lte(discovered_events.event_start_date, endDateStr),       // started at-or-before horizon
  gte(discovered_events.event_end_date, todayStr),           // ends at-or-after today
  eq(discovered_events.is_active, true),
  isNotNull(discovered_events.event_start_time),
  isNotNull(discovered_events.event_end_time)
))
```

**Proposed change (Site B, Smart Blocks today-working-set):**
```javascript
.where(and(
  eq(discovered_events.state, state),
  lte(discovered_events.event_start_date, eventDate),        // started today or earlier
  gte(discovered_events.event_end_date, eventDate),          // ends today or later
  eq(discovered_events.is_active, true)
));
```

**Why both:** the deactivation side (`cleanup-events.js`) is already multi-day correct — it removes events whose `event_end_date < today`. So storage truth is fine. But the selection sides leak the bug into briefing.events JSONB (Site A) and Smart Blocks event-input (Site B). A 4-day festival starting yesterday is missed by both queries today.

**Test cases:**
1. Insert event with `event_start_date = todayStr - 1 day`, `event_end_date = todayStr + 1 day`, `is_active = true`. Run both queries. **Expected:** event present in both result sets. **Current:** event missing from both.
2. Insert event with `event_end_date = todayStr - 1 day`. Run both queries. **Expected:** event absent (already past — also caught by deactivation, but query should be defensive).
3. Insert event with `event_start_date = todayStr + 8 days`. Run Site A query (7-day horizon). **Expected:** event absent (beyond horizon).
4. Insert single-day event with `event_start_date = event_end_date = todayStr`. Both queries return it. **Expected:** unchanged behavior for single-day events.

**Log line (Site A — briefing read):**
```
[BRIEFING] [EVENTS] [DB] [discovered_events] [READ] [ACTIVE-TODAY] [NEW EVENTS PIPELINE] state=XX, today=YYYY-MM-DD, horizon=YYYY-MM-DD, count=N — multi-day inclusive (start<=horizon AND end>=today)
```

**Log line (Site B — Smart Blocks fetch):** the existing line at `enhanced-smart-blocks.js:236-241` is already informative (state-wide → within-Nmi → near/far split). Append the marker only:
```
[VENUE] [EVENTS] [DB] [discovered_events] [METRO-CONTEXT] [NEW EVENTS PIPELINE] N state-wide → M within Xmi (P near, Q far, dropped R out-of-metro/orphan) — multi-day inclusive
```

#### G1.2 Validator's "today" check uses server UTC instead of snapshot timezone

**Site:** `validateEvent.js:147-153` (quoted in §2 above).

**Problem:** A driver in Pacific/Honolulu (UTC-10) at 11:30 PM local time has events for tomorrow's UTC date rejected as "not today." Spec §9.2 lists this as a known global-app blocker.

**Proposed change:**
```javascript
// validateEvent now accepts an optional context for tz-aware today-check
export function validateEvent(event, context = {}) {
  // [...rules 1-12 unchanged...]

  // Rule 13: Date must be today or yesterday in driver's local timezone
  const tz = context.timezone;
  const today = tz
    ? new Date().toLocaleDateString('en-CA', { timeZone: tz })
    : new Date().toISOString().split('T')[0];                // legacy UTC for callers w/o tz
  const yesterdayDate = new Date(Date.now() - 86400000);
  const yesterday = tz
    ? yesterdayDate.toLocaleDateString('en-CA', { timeZone: tz })
    : yesterdayDate.toISOString().split('T')[0];
  if (event.event_start_date !== today && event.event_start_date !== yesterday) {
    return { valid: false, reason: 'not_today', field: 'event_start_date' };
  }
  return { valid: true, reason: null, field: null };
}

// validateEventsHard threads context through:
export function validateEventsHard(events, options = {}) {
  const { logRemovals = true, phase = 'VALIDATE', context = {} } = options;
  // [...]
  for (const event of events) {
    const result = validateEvent(event, context);
    // [...]
  }
}
```

**Caller change in `briefing-service.js:1339`:**
```javascript
// Before:
const { valid: validatedEvents } = validateEventsHard(normalized);

// After:
const { valid: validatedEvents } = validateEventsHard(normalized, {
  context: { timezone: snapshot.timezone }
});
```

**Schema-version bump:** `VALIDATION_SCHEMA_VERSION` increments from `4` → `5` since the rule changed semantically (UTC → tz-aware). Stored rows with `schema_version = 4` will still pass `needsReadTimeValidation` correctly.

**Test cases:**
1. With `timezone='Pacific/Honolulu'` at 11:45 PM HST (server UTC = next day 09:45), event with `event_start_date = HST today` → **valid**. Without timezone, same event → **rejected** (`not_today`).
2. With `timezone='Asia/Tokyo'` at 00:30 JST (server UTC = previous day 15:30), event with `event_start_date = JST today` → **valid**.
3. Backwards compat: caller without `context` → behaves as before (UTC-based check).

**Log line (only when timezone is missing — existing behavior):** unchanged. No new log unless we want to surface "tz-aware today-check applied" — keep silent on the success path to avoid noise.

#### G1.3 Orphan-event telemetry

**Currently:** `enhanced-smart-blocks.js:236-241` logs `state-wide → within-Nmi → near/far + dropped` but lumps "beyond metro radius" with "orphan event with null venue coords" into one `dropped` count.

**Proposed change in `fetchTodayDiscoveredEventsWithVenue`:**
```javascript
const withDistance = rows
  .map(row => ({
    ...row,
    _distanceMiles: haversineMiles(driverLat, driverLng, row.vc_lat, row.vc_lng),
    _isOrphan: row.vc_lat == null || row.vc_lng == null               // explicit classification
  }));

const orphanCount = withDistance.filter(r => r._isOrphan).length;
const reachable = withDistance
  .filter(r => !r._isOrphan && r._distanceMiles <= maxDistanceMiles)
  .sort((a, b) => a._distanceMiles - b._distanceMiles);
const beyondMetro = withDistance.length - orphanCount - reachable.length;

const nearCount = reachable.filter(r => r._distanceMiles <= 15).length;
const farCount = reachable.length - nearCount;

console.log(
  `[VENUE] [EVENTS] [DB] [discovered_events] [METRO-CONTEXT] [NEW EVENTS PIPELINE] ` +
  `${rows.length} state-wide → ${reachable.length} planner-ready within ${maxDistanceMiles}mi ` +
  `(${nearCount} near ≤15mi candidates, ${farCount} far >15mi surge intel) — ` +
  `excluded: ${orphanCount} orphan (null venue coords), ${beyondMetro} beyond-metro`
);

return reachable;
```

**Test cases:**
1. Insert 3 reachable + 2 orphan + 1 beyond-metro event. Log shows `3 planner-ready / 2 orphan / 1 beyond-metro`.
2. Orphan events do not appear in returned array (unchanged from current).

### P2 — venue_catalog canonical identity integrity (amended per review)

#### G2.1 Planner-grade venue gate — **classify and log, don't silently filter**

**Currently:** Implicit only — orphan events silently fall out via haversine `Infinity`.

**Proposed change in `server/lib/venue/venue-cache.js`** (new export):
```javascript
/**
 * Spec §5.3: a venue is planner-grade only when it carries the full identity
 * needed for the planner / matcher / map: place_id, formatted_address, city,
 * state, lat, lng, timezone. This predicate classifies the venue without
 * mutating anything; callers decide whether to drop, re-resolve, or quarantine.
 *
 * Returns { ok: boolean, missing: string[] } so callers can log which fields
 * failed for telemetry.
 */
export function isPlannerGradeVenue(v) {
  if (!v) return { ok: false, missing: ['venue (null)'] };
  const required = ['place_id', 'formatted_address', 'city', 'state', 'lat', 'lng', 'timezone'];
  const missing = required.filter(f => v[f] == null || v[f] === '');
  return { ok: missing.length === 0, missing };
}
```

**Caller in `enhanced-smart-blocks.js:fetchTodayDiscoveredEventsWithVenue`** classifies into 3 buckets (planner-ready / orphan / re-resolve-needed). The "re-resolve-needed" bucket is venues that have a `vc_place_id` but are missing other fields (e.g., null timezone) — recoverable via Places (NEW) API.

```javascript
import { isPlannerGradeVenue } from './venue-cache.js';

// Inside fetchTodayDiscoveredEventsWithVenue, after the join read:
const classified = rows.map(row => {
  // Rebuild a venue-shape from vc_* fields for the predicate
  const venueShape = {
    place_id: row.vc_place_id,
    formatted_address: row.vc_formatted_address,
    city: row.vc_city,
    state: row.vc_state,
    lat: row.vc_lat,
    lng: row.vc_lng,
    timezone: row.vc_timezone        // requires vc_timezone added to the select projection
  };
  const { ok, missing } = isPlannerGradeVenue(venueShape);
  let bucket;
  if (ok) bucket = 'planner-ready';
  else if (row.vc_place_id) bucket = 're-resolve-needed';     // recoverable via Places (NEW)
  else bucket = 'orphan';
  return { ...row, _bucket: bucket, _missing: missing };
});

const counts = classified.reduce((a, r) => ({ ...a, [r._bucket]: (a[r._bucket] || 0) + 1 }), {});
console.log(
  `[VENUE CATALOG] [GATE] [PLANNER-GRADE] [NEW EVENTS PIPELINE] ` +
  `planner-ready=${counts['planner-ready'] || 0}, ` +
  `re-resolve-needed=${counts['re-resolve-needed'] || 0}, ` +
  `orphan=${counts.orphan || 0} — ` +
  `gate prevents incomplete venues from reaching planner input (spec §5.3)`
);
// Only planner-ready rows continue downstream; re-resolve-needed are logged for backfill,
// orphan are dropped (already the current behavior).
const plannerReady = classified.filter(r => r._bucket === 'planner-ready');
```

**Note on `vc_timezone`:** the current `fetchTodayDiscoveredEventsWithVenue` projection (lines 179-206 of `enhanced-smart-blocks.js`) does not select `venue_catalog.timezone`. We add it.

**Why classify, not silently drop:** Melody's amendment — spec §5.3 wants explicit visibility. `re-resolve-needed` is the bridge to a future automated venue-address backfill (P2 priority 4 in the spec, out of this plan).

**Test cases:**
1. Three venues: complete (place_id + addr + city + state + lat + lng + tz), missing timezone (re-resolve), missing place_id+coords (orphan). Predicate returns `{ ok: true }`, `{ ok: false, missing: ['timezone'] }`, `{ ok: false, missing: ['place_id', 'lat', 'lng', ...] }`.
2. Pipeline run: log shows the 3-bucket counts; only planner-ready reaches the matcher.

#### G2.2 "Places (NEW) API" wording sweep — observability polish

**Status:** approved as polish, not a correctness blocker. Per Melody's review.

**Approach:** read each file once, edit log strings + JSDoc that say bare "Places API" → "Places (NEW) API" or just "Places (NEW)". No global replace; touch only files in this plan's scope:
- `briefing-service.js` (event-discovery comments + log strings)
- `venue-cache.js` (findOrCreateVenue + maybeReResolveAddress comments)
- `enhanced-smart-blocks.js`
- `event-matcher.js`
- `docs/EVENTS.md` (table at lines 169-176; venue-cache row references)

**No code-behavior change.** Pure observability/doc.

**Acceptance:** post-pass log lines and module-level JSDoc say "Places (NEW) API". `validateVenueAddress` / `searchPlaceWithTextSearch` function names are NOT renamed (those are stable contract names).

---

## 4. Implementation steps (after approval)

In dependency order. Each step a separate commit.

| Step | Files | Test | Tag scope |
|------|-------|------|-----------|
| 1 | `server/lib/events/pipeline/validateEvent.js` (G1.2 timezone-aware Rule 13 + bump `VALIDATION_SCHEMA_VERSION` to 5) | Pacific/Honolulu, Asia/Tokyo unit tests; backwards-compat (no tz arg) | none — silent success path |
| 2a | `server/lib/briefing/briefing-service.js:1542-1544` (G1.1 Site A multi-day query + new `[BRIEFING] [...] [READ] [ACTIVE-TODAY] [NEW EVENTS PIPELINE]` log) | Multi-day fixture event spanning yesterday → tomorrow appears; single-day unchanged | new log + amend existing read line |
| 2b | `server/lib/venue/enhanced-smart-blocks.js:211` (G1.1 Site B multi-day query) | Same fixture appears in Smart Blocks fetch; single-day unchanged | amend existing log to append `[NEW EVENTS PIPELINE]` |
| 3 | `server/lib/venue/enhanced-smart-blocks.js fetchTodayDiscoveredEventsWithVenue` (G1.3 orphan/beyond-metro telemetry) | 3-reachable + 2-orphan + 1-beyond-metro fixture; log shows split | amend existing log line |
| 4 | `server/lib/venue/venue-cache.js` (G2.1 add `isPlannerGradeVenue` export) + caller in `enhanced-smart-blocks.js` adds 3-bucket classification + log + add `vc_timezone` to select projection | 3-venue completeness fixture; log shows 3-bucket counts; only planner-ready reach matcher | new `[VENUE CATALOG] [GATE] [PLANNER-GRADE] [NEW EVENTS PIPELINE]` log |
| 5 | "Places (NEW) API" wording sweep across log strings + JSDoc + `docs/EVENTS.md` | grep at runtime: no log line says bare "Places API" | doc-only |

Each step's commit message references this plan path so future sessions can locate the rationale.

**Per Rule 1, no code is touched until Melody confirms approval. After implementation, formal testing approval ("All tests passed") gates merge.**

---

## 5. Out-of-scope (explicit, per memory #245)

- **Deterministic pre-LLM event score (P3 in REV-0):** deferred to its own plan with explicit guardrails — far events stay intelligence-only, 15-mile destination rule absolute, no narrowing of Gemini discovery to "desperate-driver mode." That plan will be `PLAN_events-pre-llm-scoring-YYYY-MM-DD.md`.
- **Matcher telemetry summary log:** the per-match debug lines already use the strong-key chain (`place_id → venue_id → name`). A summary line at info-level is part of the deferred P3 plan since it's adjacent to the scoring layer.
- **§5.4 full taxonomy** (planner-ready / briefing-only / re-resolve-required / orphaned as a strict 4-state classifier on every event): G2.1 in this plan adds 3-bucket telemetry; the full operational taxonomy with downstream consumers is a separate plan.
- **§5.3 venue suspect/quarantine state on `venue_catalog`:** schema column addition (e.g., `record_status = 'suspect'`); separate plan.
- **Automated batch venue-address cleanup:** `scripts/backfill-venue-addresses.js` exists as a manual tool; automation is its own plan.
- **Verify-then-delete of `filterEventsForPlanner` (filter-for-planner.js:110-140):** needs import-trace pass (read every importer of `filter-for-planner.js`); tracked as a follow-up task, not deleted in this plan.
- **Group C (7-route inline filter consolidation in `briefing.js`):** covered by `duplicate-functions-fix-plan-2026-04-28.md`. Run that plan first or in parallel.
- **Desperation/bottleneck override as a strategist signal:** future P3 plan; lives in selection/ranking layer, not discovery.

---

## 6. Acceptance criteria (narrowed per review)

This plan is complete when:

1. **Multi-day fixture event** (start = yesterday, end = tomorrow) appears in:
   - briefings.events JSONB after a snapshot run (Site A fixed)
   - `enhanced-smart-blocks.js` event-input array (Site B fixed)
2. **Pacific/Honolulu / Asia/Tokyo cross-midnight events** validate as today (G1.2 fixed); UTC-only legacy callers remain unchanged.
3. **`[VENUE CATALOG] [GATE] [PLANNER-GRADE] [NEW EVENTS PIPELINE]`** log line appears once per Smart Blocks run with planner-ready / re-resolve-needed / orphan counts.
4. **`[BRIEFING] [EVENTS] [DB] [discovered_events] [READ] [ACTIVE-TODAY] [NEW EVENTS PIPELINE]`** log line appears for the briefing-side read.
5. **`[VENUE] [EVENTS] [DB] [discovered_events] [METRO-CONTEXT] [NEW EVENTS PIPELINE]`** log line in Smart Blocks fetch shows `orphan` and `beyond-metro` as separate counts (G1.3).
6. **No log line says bare "Places API"** — all reference "Places (NEW) API" (G2.2).
7. **EVENTS.md** has a small revision note at the top: "2026-04-28: tz-aware Rule 13, multi-day-inclusive read queries, planner-grade gate."

**Out of acceptance:**
- Repo-wide log restyling (every historical events log line carrying the marker) — explicitly excluded.
- Pre-LLM event scoring — deferred.
- Matcher info-level summary — deferred.

---

## 7. Files affected (summary)

| File | Step | Change type |
|------|------|-------------|
| `server/lib/events/pipeline/validateEvent.js` | 1 | tz-aware Rule 13; schema version bump |
| `server/lib/briefing/briefing-service.js` | 2a, 5 | multi-day predicate + tagged log; "Places (NEW) API" wording |
| `server/lib/venue/enhanced-smart-blocks.js` | 2b, 3, 4, 5 | multi-day predicate; orphan/beyond-metro telemetry; planner-grade classification + log; wording |
| `server/lib/venue/venue-cache.js` | 4, 5 | new `isPlannerGradeVenue` export; wording |
| `server/lib/venue/event-matcher.js` | 5 | wording only |
| `docs/EVENTS.md` | 5 | revision note + "Places (NEW) API" in tables |

All new logs follow Option B format: `[Parent] [Sub] [...] [NEW EVENTS PIPELINE] — why-clause`.

---

## Approval requested

REV-1 incorporates Melody's review. Awaiting:

- **Confirm REV-1 reflects your amendments.** If yes → I implement Steps 1–5 with the test cases above, in dependency order, one commit per step, each carrying the plan path in the message.
- **Per Rule 1, formal "All tests passed" approval still gates the merge** after implementation.
- **The deferred P3 plan** (deterministic event score) — should I draft it now in parallel for review, or wait until P1+P2 land?
