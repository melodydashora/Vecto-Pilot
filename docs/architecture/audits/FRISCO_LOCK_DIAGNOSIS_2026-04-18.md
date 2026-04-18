---
date: 2026-04-18
session_id: 2026-04-17-frisco-lock
scope: 7-part diagnosis of "Frisco-lock" — the app is only usable in Frisco/DFW
status: recon complete; code changes pending Melody's greenlight
author: claude-opus-4-7[1m]
related_memory_ids: [161, 162, 163, 164, 165, 166, 167]
depends_on_audit: docs/architecture/audits/RECON_2026-04-17_HANDLES_LOCALITY.md
constraints_honored:
  - read_only: true
  - schema_changes: none
  - prod_db_touched: false
  - DECISIONS_md_modified: false
  - migrations_applied: none
  - code_changes: none
  - dev_server_restarted: false
---

# Frisco-Lock Diagnosis — 2026-04-18

Seven-part read-only diagnosis covering: coverage map, Frisco pollution, silent-failure traces, market-resolution fallback, event-discovery latency, session timeout, and a recon-vs-code drift re-check on `getOfferHistory`. Triggered by Melody's 12-hour shift in which she got nothing useful outside Frisco.

## Preamble — Context Going In

- Melody pulled a 12-hour shift and got nothing useful outside Frisco. Prod logs confirm: **Frisco = full data, Bedford (DFW Metro) = empty**.
- A COACH_MEMO dated **2026-04-17 21:59:56** in `docs/coach-inbox.md` flags a live bug: *"Briefing Tab infinite loading state for Airport, News, and Events."*
- Prod log shows Gemini event discovery took **45621 ms (45 s)** — if a driver is moving, that latency window matters.
- Working hypothesis going in: **primarily a SEED DATA COVERAGE problem with NO GRACEFUL DEGRADATION**, not code hardcoding. The prior recon (`RECON_2026-04-17_HANDLES_LOCALITY.md`) already ruled out Frisco string hardcodes as the cause.

**Hypothesis verdict: CONFIRMED, with one critical amendment.** The infinite-loading bug (Parts C + D) is the *proximate* cause of "outside Frisco shows nothing" — and it affects *every* market with partial content, not just non-DFW markets. A fix for the 202-on-empty pattern helps Frisco too.

## Executive Summary

| Part | Subject | One-line verdict |
|------|---------|------------------|
| A | Coverage map | Resolution layer healthy; content layer near-empty outside DFW. 4 different market-slug conventions for DFW alone. |
| B | Frisco pollution + Bedford test | No Frisco pollution bug. Bedford resolves cleanly to `dallas-fort-worth-tx`. Failure is downstream of resolution. |
| C | Silent-failure trace | **ROOT CAUSE found.** 4 of 6 sub-endpoints return **HTTP 202** on empty data → client polls forever → infinite loading spinner. |
| D | Market resolution fallback | Fail-CLOSED with `'[unknown-market]'` placeholder. Gemini returns empty for that prompt → null JSONB → 202 trap. No retry, no hang. |
| E | Event discovery latency | 45 s is the floor, not an outlier. Discovery is per-snapshot with no per-market cache. During the 45 s, all tabs show spinners. |
| F | Session 2-hour timeout | Hard 2h cap + 60-min sliding window. No JWT refresh mechanism. A 12-hour shift triggers 5–6 forced re-logins. |
| G | `getOfferHistory` drift re-check | Prior recon STANDS. No `WHERE user_id`. The coherent-looking prod log is a single-user artifact, not user scoping. |

---

## PART A — Coverage Map

**Resolution-layer tables (broad, healthy):**

| Table | Coverage |
|-------|----------|
| `market_cities` | 1000+ cities across 50 states. CA 509, FL 206, AL 108, CT 95, TX 89 … every US metro. |
| `markets` | Global (Abu Dhabi, Adelaide, Austin, Bangkok, Berlin, Beaumont-TX, every US major). |

**Content-layer tables (near-empty outside DFW) — matrix form:**

| Table | DFW | Beaumont | Austin | Houston | LA | NYC | SF | Every other US market |
|-------|----:|---------:|-------:|--------:|---:|----:|---:|----------------------:|
| `discovered_events` | 1179 | 9 | **0** | **0** | **0** | **0** | **0** | **0** |
| `venue_catalog` (by market_slug) | 162 (`dfw`) + 4 (`dallas-fort-worth-tx`) | 2 | **0** | **0** | **0** | **0** | **0** | **0** (plus 338 rows with NULL market_slug) |
| `zone_intelligence` | 1 | **0** | **0** | **0** | **0** | **0** | **0** | **0** |
| `market_intelligence` | 1 | **0** | **0** | 1 | 2 | **0** | 2 | 14 rows tagged `universal` + handful of single-row markets |
| `traffic_zones` | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **0 — EMPTY table** |
| `market_intel` | — | — | — | — | — | — | — | **0 — EMPTY table** |
| `staging_saturation` | — | — | — | — | — | — | — | **0 — EMPTY table** |
| `travel_disruptions` | 456 (DFW airport code) + 1 (DAL) | — | — | — | — | — | — | Airport-code-scoped, not market-scoped |
| `safe_zones` | — (user-scoped, not market-scoped) | — | — | — | — | — | — | Scoped by `user_id` + `lat/lng` geometry only |
| `briefings` (via snapshot.market) | 197 | — | 1 | **0** | **0** | **0** | **0** | **0 — only DFW drivers have ever generated briefings** |

**N=0 threshold conclusion:** For every US market outside DFW metro + Beaumont, `discovered_events`, `venue_catalog`, `zone_intelligence`, `traffic_zones`, and `briefings` are **zero rows**. Market resolution works globally, but there is nothing for the resolved market to point at.

**Market-slug naming inconsistency (flagged):**

| Source | Slug for DFW metro |
|--------|--------------------|
| `market_cities.market_slug` | `dallas-fort-worth-tx` |
| `markets.market_slug` | (not checked but implied by `market_cities`) |
| `venue_catalog.market_slug` (162 rows) | `dfw` (literal) |
| `zone_intelligence.market_slug` | `dallas-fort-worth` (no `-tx`) |
| `market_intelligence.market_slug` | `dallas-fort-worth` (no `-tx`) |
| `snapshots.market` | `Dallas-Fort Worth` (title case, spaces) |

**Four distinct conventions for the same metro.** Any cross-table JOIN on `market_slug` misses.

---

## PART B — Frisco Pollution Audit + Bedford Smoking-Gun Resolution Test

### Bedford — market resolution test

```sql
SELECT city, state_abbr, market_name, market_slug
FROM market_cities WHERE city ILIKE 'bedford';
```
Result: `Bedford | TX | Dallas-Fort Worth | dallas-fort-worth-tx`.

All 30 DFW metro cities checked (Bedford, Hurst, Euless, Grapevine, Irving, Frisco, Dallas, Arlington, Plano, Fort Worth, Keller, McKinney, Lewisville, Coppell, Colleyville, Mesquite, Carrollton, Addison, Allen, Benbrook, Denton, Farmers Branch, Garland, Grand Prairie, Mansfield, Murphy, N Richland Hills, Prosper, Richardson, and Frisco itself) — all map to `dallas-fort-worth-tx`.

**Conclusion:** market resolution is NOT the failure. Bedford → DFW resolves. If Melody's Bedford driver saw empty data, the failure is downstream of market resolution.

### Pattern 1 — Address mismatch (Globe Life Field pattern)

```sql
SELECT COUNT(*) FROM venue_catalog
WHERE address ILIKE '%Frisco, TX%' AND city != 'Frisco';
```
Result: **0 rows**. The 2026-04-11 venue-address-correctness work already cleaned this up.

### Pattern 2 — Literal Frisco/DFW-Metro in city/market columns

| Source | Count | Interpretation |
|--------|-----:|----------------|
| `venue_catalog.city = 'Frisco'` | 168 | Legitimate — Frisco venues |
| `venue_catalog.market_slug IN ('Frisco','DFW Metro','frisco','dfw-metro','dfw','DFW')` | 162 | The `'dfw'` slug, not `'Frisco'` literal |
| `driver_profiles.city = 'Frisco'` | 2 | Melody + one other |
| `driver_profiles.market = 'Frisco'` | 0 | Clean |
| `snapshots.city = 'Frisco'` | 197 | Melody's session history |
| `snapshots.market = 'Frisco'` | 0 | Clean |
| `discovered_events.city = 'Frisco'` | 317 | Legitimate — events in Frisco |

No `'DFW Metro'` string exists anywhere. No `'Frisco'` as a market literal.

### Pattern 3 — JSONB/text fields containing 'Frisco'

| Column | Rows mentioning 'Frisco' | % of total |
|--------|------------------------:|----------:|
| `briefings.traffic_conditions` | 189 / 206 | 91 % |
| `briefings.events` | 116 / 206 | 56 % |
| `briefings.school_closures` | 178 / 206 | 86 % |
| `briefings.news` | 58 / 206 | 28 % |
| `briefings.airport_conditions` | 23 / 206 | 11 % |
| `briefings.weather_current` | 0 / 206 | 0 % |
| `strategies.strategy_for_now` | 173 | — |
| `strategies.consolidated_strategy` | 3 | — |

**Is this pollution?** Cross-checked by restricting to non-Frisco snapshots:

- **Dallas** (`market=Dallas-Fort Worth`, 11 briefings): 5 news + 6 school mentions; 0 events + 0 traffic. → LEGITIMATE metro-wide data. Frisco IS in DFW metro, so a Dallas driver's DFW-wide school-closure briefing includes Frisco ISD.
- **Beaumont** (`market=Austin`, 1 briefing): 0 / 0 / 0 / 0. Clean.

**Verdict:** 197 of 209 snapshots are Melody's personal Frisco sessions. The 'Frisco contamination' in briefings is overwhelmingly explained by "most briefings were generated for a Frisco-based driver in the Frisco-containing DFW market." **No Frisco seed pollution exists as a bug.**

---

## PART C — Silent-Failure Trace (Infinite-Loading Bug ROOT CAUSE)

**Root cause:** Four of six briefing sub-endpoints return **HTTP 202 Accepted** with a null payload when the briefing JSONB subfield is empty. HTTP 202 semantically means *"still processing — retry."* The React Query / polling layer on the client therefore retries indefinitely. When a subfield stays null forever (because the market has no content OR because Gemini returned empty without setting `_generationFailed`), the client polls forever.

No code is hanging — the server returns immediately on every poll — but the VISUAL result is an infinite loading spinner.

### Per-endpoint trace (all in `server/api/briefing/briefing.js`)

| Endpoint | Empty → status | Error marker → status | Client interpretation |
|----------|----------------|----------------------|-----------------------|
| `/traffic/:snapshotId` (line 543) | **202** with `traffic: null` | 200 with `_generationFailed` | **POLL FOREVER on empty** |
| `/weather/:snapshotId` (line 497) | 200 with nulls (falls through to live fetch) | 500 on throw | **Graceful** — the only one |
| `/rideshare-news/:snapshotId` (line 589) | **202** with `news: null` | 200 with `_generationFailed` | **POLL FOREVER on empty** |
| `/events/:snapshotId` (line 681) | 200 with `events: []` + reason | 200 with empty | Empty-state OK (reads `discovered_events` directly, bypasses briefing JSONB) |
| `/school-closures/:snapshotId` (line 939) | **202** with `school_closures: null` | 200 with `_generationFailed` | **POLL FOREVER on empty** |
| `/airport/:snapshotId` (line 994) | **202** with `airport_conditions: null` | 200 with `_generationFailed` | **POLL FOREVER on empty** |

**Key asymmetry:** Melody's three reported broken tabs (Airport, News, Events) — Airport and News fit the 202 trap exactly. The Events tab does NOT return 202 from its own endpoint, so the events spin must originate from a different client-side gate (e.g., the events component gates on `briefing.status === 'ok'` upstream). Needs a targeted client-side trace to confirm.

**Fail-closed / fail-open matrix:**

| Endpoint | Behavior |
|----------|----------|
| Weather | Fail-OPEN with live refetch (only graceful-degrading endpoint) |
| Events | Fail-CLOSED with visible empty state + reason |
| Traffic | FAIL-INDETERMINATE (202 poll-forever) |
| News | FAIL-INDETERMINATE (202 poll-forever) |
| School-closures | FAIL-INDETERMINATE (202 poll-forever) |
| Airport | FAIL-INDETERMINATE (202 poll-forever) |

**Zombie recovery (lines 550, 595, 1000):** All endpoints call `triggerZombieRecoveryIfNeeded(briefing, req.snapshot)` to self-heal null-field placeholder rows. 2026-04-05 change. However, if the briefing has already been generated once with null JSONB fields (because the market produced no results), the zombie detection may not fire — a regeneration won't pull new content out of thin air.

---

## PART D — Market Resolution Fallback

`getMarketForLocation()` at `server/lib/briefing/briefing-service.js:111` returns:
- `market_name` on DB hit
- `null` on miss (per 2026-04-16 fix — previously fell back to city)

**Downstream on null:**

| Path | Line | Behavior |
|------|-----:|----------|
| Events (Claude fallback) | 326 | `searchArea = market \|\| '[unknown-market]'` — Gemini prompt literally says "events in [unknown-market] metro area" |
| Events (Gemini main) | 979 | Same `[unknown-market]` placeholder |
| Events logging + fetch | 1078, 1090 | Same |
| News path | 2383, 2390, 2395 | Same, with WARN log: *"No market resolved for ${city}, ${state} — news search will use [unknown-market] placeholder"* |
| Traffic | — | Uses `city/state + market`. Serper is city-first; works even with null market |
| School / airport | — | Similar market-scoped prompts |

**Answer matrix:**

| Question | Answer |
|----------|--------|
| Fail-CLOSED (empty) or fail-OPEN (stale Frisco)? | Fail-CLOSED. 2026-04-16 fix removed city substitution. No silent Frisco fallback. |
| Does it retry? | No. Single-pass resolution. |
| Does it hang? | No. 90-s Gemini timeout. But a 90-s successful-but-empty response still ends with null JSONB → Part C 202 trap. |

**Bedford-specific:** Bedford resolves to `dallas-fort-worth-tx`. Market is NOT null for Bedford. Gemini prompt correctly says "Dallas-Fort Worth metro area." Bedford briefings *should* populate with real DFW content. If Melody saw empty, the cause is NOT the null-market path.

**Extreme edge (rural Idaho):** `snapshot.market = null` → `[unknown-market]` in Gemini prompt → empty Gemini response → null JSONB → 202 forever.

---

## PART E — Event Discovery Latency (45 s)

**Trigger model:** Event discovery is PER-SNAPSHOT via `fetchEventsForBriefing({ snapshot })` at `briefing-service.js:1280`. Rule 11 (2026-02-17) forbids background event-sync workers.

**No per-market cache.** Two Bedford drivers who each create a snapshot trigger two independent 45-s Gemini discovery runs for "Dallas-Fort Worth metro area," even though both would produce the same DFW event set.

**Cache TTLs (per inline comments and `README.md`):**

| Subsystem | TTL |
|-----------|-----|
| Events | 4 hours |
| School closures | 24 hours by city |
| News | 24 hours |
| Traffic | 0 TTL — refresh on every snapshot |
| Weather | 0 TTL — live refetch |
| Airport | implicit 24 h with daily briefing |

**Subsystem parallelism:** Line 2779 runs `Promise.allSettled` of weather + traffic + events + airport + news. 2026-04-05 fix (was `Promise.all`, which meant one crash killed all results).

**What the UI shows during the 45 s:**
- T=0 — snapshot created, briefing row inserted with null JSONB subfields.
- T=0+ — client starts polling the 5 sub-endpoints; all return HTTP 202.
- T=0→45 — spinners on every tab. No partial render — JSONB subfields are populated wholesale, not streamed.
- T=45 — Gemini returns. Subfields populated. Next poll returns 200. Spinner clears.
- If the user is **moving** during the 45 s, the snapshot may be invalidated before briefing completes — creating a second snapshot + a second 45-s run.

**0-seed-events market edge:**
- **Bedford** (DFW): Gemini returns real DFW data → tabs populate after 45 s. OK.
- **Truly unresolvable market** (rural Idaho): Gemini returns empty for `[unknown-market]` prompt → null subfields → 202 forever.
- **DFW but Gemini API error:** `Promise.allSettled` catches the rejection; `_generationFailed` marker should be written. Depends on clean error-catching.

**Friction compound** for an Austin driver: city resolves → Gemini returns real Austin events → briefing populates. BUT `venue_catalog` for Austin is empty (Part A) → Strategy / SmartBlocks has no venues to rank. Briefing tab works; Strategy tab shows empty.

---

## PART F — Session 2-Hour Timeout

**Config** (`server/middleware/auth.js:11, 170, 186`):
- `SESSION_HARD_LIMIT_MS = 2 * 60 * 60 * 1000` (2 h absolute from `session_start_at`)
- `SESSION_SLIDING_WINDOW_MS = 60 min` (from `last_active_at`)
- Both checked on every authenticated request. Lazy cleanup — no background sweeper.

**Refresh token?** Not for the app's own JWT. `refresh_token` / `refreshToken` grep hits only Uber OAuth + Google OAuth (third-party tokens). **The Vecto Pilot JWT has no refresh path.** A 12-hour shift driver hits the hard cap 5–6 times, plus any 60-min-inactivity gaps during breaks. Each hit → re-login screen.

**UI when session clears:**
1. Server sets `users.session_id = NULL` via UPDATE (2026-01-06 fix — was DELETE, blocked by RESTRICT FKs).
2. Server returns `401 { error: 'session_expired' }`.
3. Client: `auth-context.tsx:62` handles 401. `CriticalError.tsx:40` shows *"Your session has expired or you are not signed in. Please sign in to continue."*
4. No silent re-auth. No frozen state. **Login required.**

**In-flight work preservation** (per `docs/architecture/LLM-REQUESTS.md:491`):
> "No mid-pipeline auth validation. The blocks-fast waterfall runs 60–90 s with no auth recheck. If session expires mid-pipeline, results are stored but client can't retrieve them until re-login."

Server-side results (strategies, rankings, briefings) are **persisted to DB** and survive. Client-side state is **lost**. After re-login, the app rehydrates from `snapshot_id`.

The "Session exceeded 2-hour limit for user 9216b521 - clearing session" prod log matches the exact warning at `auth.js:171`.

---

## PART G — Recon-vs-Code Drift Check on `getOfferHistory`

**Re-verification** (in response to Melody's suggestion that the prod log `[RideshareCoach] getOfferHistory: 20 offers, 55% accept rate` implies user scoping):

### Code re-read (`rideshare-coach-dal.js:1251–1309`)

```js
async getOfferHistory(limit = 20) {
  const history = await db
    .select({ /* 17 columns */ })
    .from(offer_intelligence)
    .orderBy(desc(offer_intelligence.created_at))
    .limit(limit);
  ...
  const stats = { total, accepted, rejected, accept_rate_pct, ... };
  console.log(`[RideshareCoach] getOfferHistory: ${history.length} offers, ${stats.accept_rate_pct}% accept rate`);
  return { offers: history, stats };
}
```

- Parameters: **only `limit`** (number). No `userId`. No `deviceId`. **No `WHERE` clause.**
- Caller at line 828: `this.getOfferHistory(20)` — zero scoping args.
- No application-level post-filter by user_id. The `.filter()` calls at lines 1282–1284 filter by decision/override fields only.

### Why does the prod log look per-user?

Because the fleet is one driver.

```sql
SELECT user_id, device_id, COUNT(*) FROM offer_intelligence GROUP BY ... ORDER BY 3 DESC LIMIT 10;
```

Result:

| user_id | device_id | count |
|---------|-----------|------:|
| NULL | Melody' Iphone | 243 |
| NULL | Melody's Iphone | 126 |
| NULL | Melody's IPhone | 45 |
| NULL | test | 14 |
| NULL | test-device | 4 |
| NULL | test-device-001 | 2 |
| NULL | t1 | 2 |
| NULL | test_phase2_timeout | 1 |
| NULL | test-reason | 1 |
| NULL | test-local | 1 |

**414 of 448 rows are Melody's, spread across three apostrophe encodings of "Melody's iPhone."** (Secondary finding: `device_id` encoding is brittle — three variants for one device, further motivating the `driver_handles` migration to opaque tokens.) **Zero rows have a non-null `user_id`.**

### Drift verdict

**NO DRIFT.** Prior recon claim stands. The prod log reports stats that LOOK per-user because the data happens to be single-user — which is precisely why this bug would hide until a second driver joins.

**Tonal refinement only:** the headline should be *"single-user masking a latent multi-user bug"* rather than *"active cross-user contamination."* Phase 1 (driver_handles → `user_id` scoping) remains necessary.

---

## Smallest Changes for Usability Outside Frisco

Ordered by **bang-for-buck** (estimated usability delta ÷ implementation cost):

### 1. Flip the 202 trap — **highest impact, smallest change**

In `server/api/briefing/briefing.js`, change the 4 endpoints that return 202 on empty data to return **200 with an explicit sentinel**:

```js
if (!briefing?.traffic_conditions) {
  return res.status(200).json({
    success: true,
    _coverageEmpty: true,
    reason: 'No traffic data for your market yet',
    traffic: null,
    timestamp: new Date().toISOString()
  });
}
```

Apply to `/traffic/:id`, `/rideshare-news/:id`, `/school-closures/:id`, `/airport/:id`.

Kills the infinite-loading bug in every market — Frisco, Bedford, Austin, Los Angeles, everywhere.

**Preserves** 202 semantics: keep returning 202 while generation is genuinely in progress. Distinguish by checking `briefing.status` (not yet populated vs. populated-but-empty).

### 2. Fix the `market_slug` naming convention

Pick one canonical spelling (`dallas-fort-worth-tx`) and migrate the other three (`dfw`, `dallas-fort-worth`, `Dallas-Fort Worth`) to match. Specifically:
- `venue_catalog` — update the 162 rows currently tagged `dfw`.
- `zone_intelligence` and `market_intelligence` — update to add `-tx` suffix.
- `snapshots.market` — leave the display-style value alone; all cross-joins should use `market_slug` fields.

Zero user-visible change; unblocks future JOINs that currently silently miss.

### 3. Add a per-market cross-snapshot events cache

Key on `(market_slug, date, hour_bucket)`. First snapshot of the day pays the 45-s latency; subsequent drivers in the same market within the hour get instant results.

Estimated payload: a new `market_events_cache` table + 15 lines in `fetchEventsForBriefing` to check-cache before Gemini.

### 4. Raise the 2-hour session cap for active drivers

Lowest-security, highest-UX-win:
- Detect "active driving state" — recent snapshot creation + recent Siri `analyze-offer` POST in the last 60 minutes.
- Extend `SESSION_HARD_LIMIT_MS` to 8 h or 12 h for active drivers; keep 2 h for idle.
- Silent-refresh on the client when 401 arrives, redirecting to `/auth/sign-in` with a post-login return-to deep link.

### 5. Write explicit `_coverageEmpty` markers during briefing generation

When `fetchEventsForBriefing` / `fetchTrafficConditions` / etc. receive an empty Gemini response, write a sentinel to the JSONB subfield instead of leaving it null:

```js
await updateBriefing(snapshotId, {
  traffic_conditions: { _coverageEmpty: true, reason: 'No traffic data for this market', at: new Date() }
});
```

Pairs with fix #1 above. Distinguishes "Gemini succeeded with 0 results" from "Gemini failed" from "still running."

### 6. Expand seed coverage (operational, not code)

Prioritize seeding `venue_catalog` + `market_intelligence` + `zone_intelligence` for the next N markets where real drivers are likely to show up. Not a hard-block for Frisco-lock remediation — the 202 fix makes empty markets at least usable — but the Strategy tab will stay empty until seed coverage exists.

### 7. Stretch goal: session 12-hour extension via refresh token

Standard OAuth 2.0 refresh-token pattern. Longer-lived refresh token (7–30 days) + short-lived access token. Eliminates the 5–6 forced re-logins per shift.

---

## Revised Phase Sequence

Based on the findings above, the original 5-phase plan from `RECON_2026-04-17_HANDLES_LOCALITY.md` needs reordering. The Frisco-lock symptoms are primarily triggered by the 202 trap (silent failure) and the 2-hour session cap — both unrelated to identity migration. **These should ship before Phase 1.**

| New phase | Old phase | Work | Reason it moves |
|-----------|-----------|------|-----------------|
| **0a** | — | **Fix the 202 trap** (change 4 endpoints to 200 with `_coverageEmpty` sentinel + client empty-state rendering) | Kills the infinite-loading bug for every driver in every market *today*, unrelated to identity |
| **0b** | — | **Raise session cap for active drivers** (detect driving state + extend to 8–12 h, or add silent-refresh on 401) | Directly fixes Melody's 12-hour-shift re-login cycle |
| **0c** | — | **Standardize `market_slug` conventions** (pick `dallas-fort-worth-tx`; migrate `dfw` / `dallas-fort-worth` / `Dallas-Fort Worth` to match) | Unblocks cross-table joins for every subsequent phase |
| **1** | 1 | `driver_handles` table + token generator + `resolveHandle` + `analyze-offer` hard-cut | Unchanged |
| **2** | 2 | `/co-pilot/preferences` page + handle generator UI | Unchanged |
| **3** | 3 | UberX 20-mile rule | Unchanged |
| **4** | 4 | Parameterize `PHASE2_SYSTEM_PROMPT`, fix diagnostics default, optional demo genericization | Unchanged |
| **4b** | (new) | Per-market cross-snapshot events cache keyed on `(market_slug, date, hour_bucket)` | Emerged from Part E finding — 45-s floor is not per-market shared |
| **5a-5e** | 5a-5e | Coach big-table deepening — user-scope `getOfferHistory`, expand SELECT, add analytical helpers, feed strategy/venue, override feedback loop | Unchanged (depends on Phase 1 for `user_id` scoping) |
| **5f** | 5f | Add operator-relevant tables to CoachDAL | Unchanged |
| **5g** | 5g | Client log hygiene | Unchanged |
| **6** | (new) | Write `_coverageEmpty` sentinel during briefing generation (empty-vs-failed-vs-pending distinction at the generator layer, not just the route layer) | Emerged from Part C+D — cleaner long-term fix than the route-layer patch in Phase 0a |

**Critical-path impact:** Phases 0a and 0b ship IMMEDIATELY and should unblock Melody's 12-hour shift use case without touching identity. Phase 0c is a data migration but can be run with `UPDATE` statements in one transaction. After 0a–0c, the original 1 → 2 → 3 critical path is preserved.

**Open questions (awaiting Melody decision):**

| # | Question |
|---|----------|
| QF1 | Ship 0a as a one-liner status-code flip, or the full `_coverageEmpty` sentinel design (Phase 6)? |
| QF2 | 0b — extend the 2h cap for active drivers (cheap) or add a full refresh-token mechanism (right long-term)? |
| QF3 | 0c — migrate `market_slug` data in dev only first, or dev + prod atomically? |
| QF4 | Does the revised phase plan replace the prior plan, or are they two sequenced chapters? |

---

## Memory Index

| # | Part | Title |
|---|------|-------|
| 161 | A | Coverage map (data-coverage theory CONFIRMED) |
| 162 | B | Frisco pollution audit + Bedford smoking-gun resolution test |
| 163 | C | Silent-failure trace (infinite-loading bug ROOT CAUSE found) |
| 164 | D | Market resolution fallback (fail-CLOSED with garbage placeholder) |
| 165 | E | Event discovery latency + freshness (45 s is the floor) |
| 166 | F | Session 2-hour hard cutoff + 60-min sliding window (no refresh) |
| 167 | G | `getOfferHistory` drift check — prior claim STANDS |

---

## Constraints Honored

- Read-only throughout. DEV DB only.
- No code edits. No file mutations in `server/` or `client/`.
- No schema changes. No migrations applied.
- Prod DB never touched.
- `DECISIONS.md` not modified. Doctrine candidates from prior recon remain unpromoted.
- Dev server not restarted.
- Idempotent if re-run.
