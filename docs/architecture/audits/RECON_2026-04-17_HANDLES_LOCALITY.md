---
date: 2026-04-17
session_id: 2026-04-17-handles-recon
scope: Parts A–E — coach big-table access, Phase 1 identity foundation (driver_handles), Phase 2 preferences page, client log hygiene, briefing locality audit
status: recon complete; code changes pending Melody's greenlight
author: claude-opus-4-7[1m]
related_memory_ids: [152, 153, 154, 155, 156, 157]
constraints_honored:
  - read_only: true
  - schema_changes: none
  - prod_db_touched: false
  - DECISIONS_md_modified: false
  - migrations_applied: none
---

# Handles + Locality Recon — 2026-04-17

Durable artifact for a 5-part reconnaissance conducted on 2026-04-17 (2026-04-18 UTC) to scope the driver_handles migration (Phase 1 identity hard-cut), the Preferences page (Phase 2), client log hygiene, and the briefing-locality complaint. All reads were against the DEV DB only. Findings mirror memory entries #152–#157; this file is authoritative because memory rows can be purged while this document persists.

---

## Executive Summary

| Part | Subject | One-line verdict |
|------|---------|------------------|
| A | Coach big-table access (`offer_intelligence`) | Multi-layer gap: 4.5 % rows, 33 % cols, 1 of 13 indexes, 0 % user-scoping, 1 of 3 consumers, 0 % override-feedback. Doctrine drift vs. code. |
| B | Phase 1 identity foundation | Current contract is `device_id`-only (Siri zero-auth). `driver_handles` DDL proposed. Hard-cut internally safe — no background jobs depend on `device_id`. |
| C | Phase 2 preferences page | `/preferences` does not exist. `/co-pilot/settings` does. Proposed sibling page at `/co-pilot/preferences` → `client/src/pages/co-pilot/PreferencesPage.tsx`. |
| D | Client log hygiene | 3 `userId` emissions, all in one file (`location-context-clean.tsx`). Two full-UUID leaks at lines 386 and 489; one safer truncation at 842. |
| E | Briefing locality audit | Briefing pipeline code is NOT hardcoded to Frisco (2026-04-16 `[unknown-market]` fix). Real hardcodings: one `analyze-offer.js` Phase 2 prompt + one diagnostics default. Root cause of "no data outside Frisco" is a **data-coverage** gap in seed tables, not code. |

---

## Part A — Coach Big-Table Access (REVISED)

**Memory trail:** #152 (initial, shallow) → #157 (corrected, this doc supersedes #152's A3 conclusion).

### A.1 Table enumeration (DEV DB)

Criterion: any `public.*` table whose name matches `ILIKE '%offer%' OR '%acceptance%' OR '%reject%' OR '%analyz%'`.
Only **one** table matches:

| Table | Rows | Columns | Indexes | PK |
|-------|------|---------|---------|-----|
| `offer_intelligence` | 448 | 52 | 13 | `id UUID` |

No separate `offer_acceptance` / `offer_rejection` / `offer_analyses` tables exist. The schema is intentionally denormalized — the single table carries `decision`, `decision_reasoning`, `confidence_score`, `user_override`, raw OCR input, AI model id, parse confidence, and full GPS on every row.

(The deprecated `intercepted_signals` JSONB table still exists in the DB from before the 2026-02-17 migration, but is no longer imported by any coach code path.)

### A.2 What the coach actually reads

Entry points:
- `server/api/chat/realtime.js:90` → `rideshareCoachDAL.getCompleteContext(snapshotId)`
- `server/api/chat/chat.js:800` → same function

`getCompleteContext()` at `server/lib/ai/rideshare-coach-dal.js:828` batches ~15 reads, including `this.getOfferHistory(20)`.

Implementation: `getOfferHistory()` at `server/lib/ai/rideshare-coach-dal.js:1251–1313`:
```js
await db
  .select({ /* 17 of 52 columns */ })
  .from(offer_intelligence)
  .orderBy(desc(offer_intelligence.created_at))
  .limit(20);
```
No `WHERE` clause. Comment at line 1245: *"Queries ALL recent offers (single-user system for now). Future: link device_id → user_id for multi-user support."*

Stats computed on the 20 rows: `total`, `accepted`, `rejected`, `accept_rate_pct`, `overrides`, `avg_per_mile`, `avg_response_ms`. Surfaced into the system prompt between lines 1194–1232.

Prompt-layer schema doc at `server/api/rideshare-coach/schema.js:79–84` tells the LLM the table exists and gives this sample query:
```sql
SELECT day_part, AVG(per_mile), COUNT(*) FROM offer_intelligence WHERE platform = 'uber' GROUP BY day_part
```
**No code path implements that query**, or any other analytical query, today.

### A.3 The delta — six-layer gap

| Dimension | What `getOfferHistory(20)` does | What the table supports | Utilization |
|-----------|--------------------------------|-------------------------|-------------|
| Rows | Last 20 by `created_at DESC` | 448 rows | **4.5 %** |
| Columns | 17 projected in SELECT | 52 available | **33 %** |
| Indexes | Only `idx_oi_created_at` | 13 purpose-built | **1 of 13** |
| User scoping | None | `idx_oi_user_id` already exists | **0 %** |
| Downstream consumers | Coach prompt | Coach + Strategy + Venue scoring | **1 of 3** |
| Override feedback | None | `user_override` column is written | **0 %** |

#### A.3.a Unused indexes (analytical queries sitting idle)

| Index | Intended query | Coaching use |
|-------|----------------|--------------|
| `idx_oi_market_daypart` | Avg $/mi by `(market, day_part, platform)` | "What's your Tuesday-morning accept rate?" |
| `idx_oi_h3_decision` | Best offer areas by H3 cell | "Which zone paid best last month?" |
| `idx_oi_date_platform` | Daily pricing floor | "Has Uber's $/mi dropped this week?" |
| `idx_oi_weekend_hour` | Weekend vs. weekday pattern | "Why did your weekend accept rate drop?" |
| `idx_oi_session_seq` | Within-session sequence analysis | "After 3 rejects in a row, do you accept worse offers?" |
| `idx_oi_driver_location` | Spatial lookup on `(driver_lat, driver_lng)` | "From your staging spot, what's the average offer?" |
| `idx_oi_override` | Override rate + patterns | "When do you disagree with me most?" |
| `idx_oi_per_mile` | Best-offer ranking | "What's your best offer this week?" |
| `idx_oi_user_id` | **User-scoped reads — infrastructure ready but unused** | Required for multi-user safety |

#### A.3.b Columns the coach never sees (35 of 52)

- **Economic:** `per_minute`, `hourly_rate`, `advantage_pct`
- **Route:** `pickup_miles`, `ride_miles`, `ride_minutes`, `total_minutes`, `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`, `coord_key`, `geocoded_at`
- **Driver position:** `driver_lat`, `driver_lng`
- **Temporal:** `local_hour`, `day_of_week`, `is_weekend`, `timezone`
- **Provenance/quality:** `ai_model`, `parse_confidence`, `source`, `input_mode`
- **Sequence:** `seconds_since_last` (the two sibling columns `offer_session_id` + `offer_sequence_num` *are* read)
- **Raw:** `raw_text`, `raw_ai_response`, `parsed_data_json`
- **Meta:** `updated_at`

### A.4 Doctrine drift

`docs/architecture/OFFER_ANALYZER.md` §13.1 asserts:
> "Last 20 rows from `offer_intelligence` **for the user's device**."

Actual code at `rideshare-coach-dal.js:1253–1276` has no `WHERE` clause on `device_id` or `user_id`. The doctrine describes the *intended* contract; the DAL quietly violates it. Multi-user offers cross-contaminate any driver's coach context today.

### A.5 Documented downstream gaps (reproduced for the record)

Already flagged in `OFFER_ANALYZER.md`:
- **§13.2** — *"Offer data is not directly injected into strategy generation today."*
- **§16 #5** — *"No user-override learning — `user_override` is stored but never feeds back into thresholds or prompts."*
- **§16 #6** — *"No offer data in strategy prompt. Strategy generation ignores offer patterns. Venue scoring could weight areas by historic $/mi."*

### A.6 Other coach-relevant tables not imported by the DAL

Context: 56 public tables exist in DEV; CoachDAL imports 22 of them. After excluding auth/cache/internal plumbing (`auth_credentials`, `oauth_states`, `verification_codes`, `uber_connections`, `coords_cache`, `places_cache`, `http_idem`, `block_jobs`, `triad_jobs`, `connection_audit`) and the 6-table memory sprawl flagged in memory #151, these tables are operator-relevant and unimported:

| Table | Why it matters to the coach |
|-------|------------------------------|
| `driver_goals` | Driver's stated goals — should shape coaching tone and priority |
| `driver_tasks` | Driver's to-do list — actionable context |
| `safe_zones` | **Safety-critical**; unread by coach |
| `staging_saturation` | Real-time staging capacity intel |
| `traffic_zones` | Traffic intel |
| `travel_disruptions` | Road closures |
| `venue_events` | Venue ↔ event linkage |
| `llm_venue_suggestions` | AI-suggested venues |
| `concierge_feedback` | Passenger-side feedback lane |
| `app_feedback` | Driver-side feedback lane (coach does not read) |
| `market_intel` | Distinct from `market_intelligence`; coach imports only the latter |

Static reference (low priority): `markets`, `market_cities`, `countries`, `vehicle_makes_cache`, `vehicle_models_cache`.

---

## Part B — Phase 1 Identity Foundation

**Memory trail:** #153.

### B.1 Current identity contract on `/api/hooks/analyze-offer`

Source: `docs/architecture/OFFER_ANALYZER.md` §1.1 and §2.2. Confirmed against code at `server/api/hooks/analyze-offer.js:186–203`.

- **Zero-auth, public endpoint.** Siri Shortcuts cannot carry JWTs; flagged HIGH-risk in `SECURITY.md`.
- `device_id: string` — **REQUIRED**, stable per-device identifier.
- `user_id?: string` — optional, **no FK constraint** (headless ingestion allowed).
- `latitude` / `longitude` rounded to 6 decimals (~11 cm) server-side.
- Companion device-scoped routes:
  - `GET /api/hooks/offer-history?device_id=…&limit=20`
  - `POST /api/hooks/offer-override`
  - `POST` batch delete

### B.2 `driver_profiles` schema and DEV DB state

From `shared/schema.js:944` + `psql \d driver_profiles` + `pg_indexes`:

**Core identity**
- `id UUID PK DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE RESTRICT`
- UNIQUE: `email`, `google_id`, **`concierge_share_token`** *(precedent: share-token pattern already exists on this table)*

**~54 columns grouped:**
- Personal: `first_name`, `last_name`, `driver_nickname`, `email`, `phone`, `address_1`, `address_2`, `city`, `state_territory`, `zip_code`, `country` (default `'US'`)
- Market: `market`
- Platforms: `rideshare_platforms JSONB` default `'["uber"]'`; per-tier flags (`uber_black`, `uber_xxl`, `uber_comfort`, `uber_x`, `uber_x_share`)
- Eligibility: `elig_economy` (default `true`), `elig_xl`, `elig_xxl`, `elig_comfort`, `elig_luxury_sedan`, `elig_luxury_suv`
- Attributes: `attr_electric`, `attr_green`, `attr_wav`, `attr_ski`, `attr_car_seat`
- Service prefs: `pref_pet_friendly`, `pref_teen`, `pref_assist`, `pref_shared`
- Home: `home_lat`, `home_lng`, `home_formatted_address`, `home_timezone` (all NULLABLE)
- Verification: `marketing_opt_in`, `terms_accepted_at`, `terms_version`, `email_verified`, `phone_verified`, `profile_complete`
- Timestamps: `created_at`, `updated_at`

**Indexes (5):** `pkey(id)`, `user_id_unique`, `email_unique`, `google_id_key`, `concierge_share_token_key`.

**DEV DB `has_home` check** (`SELECT user_id, home_lat IS NOT NULL AS has_home, home_lng IS NOT NULL AS has_lng FROM driver_profiles LIMIT 50`):

| user_id | has_home | has_lng |
|---------|----------|---------|
| f52625ff-9287-4e2b-ac92-cfbfb7612776 | t | t |
| dc63444d-c489-4cd7-88c1-ad76cff88ad4 | t | t |
| 2f22004b-c5cc-43c9-a5a6-02f50ccff571 | t | t |

3 rows, **100 % home-coord coverage.**

### B.3 Route enumeration

#### JWT path — `req.auth.userId` set by `requireAuth` middleware (user_id REQUIRED)

| File | Lines |
|------|-------|
| `server/api/auth/auth.js` | 965, 1076, 1280 |
| `server/api/briefing/briefing.js` | 214, 286, 387, 619, 1110, 1123, 1176 |
| `server/api/chat/chat.js` | 592, 628, 644, 713, 782, 1394, 1409, 1444, 1482, 1512, 1526, 1560 |
| `server/api/chat/realtime.js` | 81 |
| `server/api/concierge/concierge.js` | 78, 92, 108, 133, 478 |
| `server/api/feedback/feedback.js` | 64, 239, 320 |
| `server/api/feedback/actions.js` | 49 |
| `server/api/location/location.js` | 169, 1872, 1984, 2007 |
| `server/api/rideshare-coach/notes.js` | 34, 109, 146, 206, 267, 309, 354, 401 |
| `server/api/strategy/blocks-fast.js` | 147, 265, 406, 535, 537 |

#### Zero-auth `device_id` path (device_id REQUIRED)

| File | Line | Route |
|------|------|-------|
| `server/api/hooks/analyze-offer.js` | 195 | `POST /api/hooks/analyze-offer` |
| `server/api/hooks/analyze-offer.js` | 694 | `GET /api/hooks/offer-history` |
| `server/api/hooks/analyze-offer.js` | 766 | `POST /api/hooks/offer-override` |
| `server/api/hooks/analyze-offer.js` | 806 | `POST` batch delete |

**Only 4 routes in the entire repo read `device_id`. All 4 are in `analyze-offer.js`. All 4 are the zero-auth Siri surface.**

### B.4 Proposed `driver_handles` DDL (recon only — NOT applied)

```sql
CREATE TABLE driver_handles (
  handle_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  label         TEXT        NOT NULL,            -- driver-visible label e.g. 'Primary iPhone'
  token         TEXT        UNIQUE NOT NULL,      -- drv_<12 Crockford base32>
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_driver_handles_token_active
  ON driver_handles(token) WHERE revoked_at IS NULL;

CREATE INDEX idx_driver_handles_user_id ON driver_handles(user_id);
```

**Token generator spec**
- **Prefix:** `drv_` (4 chars)
- **Body:** 12 Crockford base32 chars — alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32 chars; omits `I`, `L`, `O`, `U` to prevent ambiguity)
- **Entropy:** 32^12 ≈ 1.15 × 10^18 possible tokens — collision probability negligible
- **Collision strategy:** attempt `INSERT`; on `23505` (unique_violation) regenerate and retry up to N = 3 times
- **Final shape:** `drv_` + 12 = 16-char string; voice-writable, human-readable

**Resolver contract (`resolveHandle`)**
```sql
SELECT user_id FROM driver_handles WHERE token = $1 AND revoked_at IS NULL;
UPDATE driver_handles SET last_used_at = now() WHERE token = $1;  -- fire-and-forget
-- Return null on miss → caller 401s
```

**Design note:** `driver_profiles` already carries `concierge_share_token` (unique, nullable) for the concierge feature. `driver_handles` is a *separate* multi-token table because (a) drivers may want one token per device (iPhone + iPad + backup), (b) per-token revocation is needed without losing profile data, (c) per-token `last_used_at` supports stale-token hygiene.

### B.5 Hard-cut survivability analysis

Grep pattern: any background job, cron, worker, or server-internal caller that POSTs to `/api/hooks/analyze-offer` or consumes `device_id`.

**Result: zero.**
- `server/bootstrap/workers.js` — spawns Strategy Worker child process only; makes no HTTP calls.
- `server/jobs/triad-worker.js` — no `setInterval`/`setTimeout`; consumes `triad_jobs` table only.
- **Rule 11 (2026-02-17)** already forbids background event-sync workers, which removed the main historical source of `device_id` usage.
- `server/api/concierge/concierge.js` — all 5 routes use `req.auth.userId`; zero `device_id` reads.

**Verdict: hard-cut is internally safe.** External callers are iOS Siri Shortcuts only (user-installed). Migration steps:
1. Deploy `driver_handles` table + `resolveHandle()` + `/api/handles` generator route.
2. Update `analyze-offer.js` to accept `handle_token` and deprecate `device_id`.
3. Publish new Siri Shortcut with `handle_token` field.
4. Communicate to drivers to re-install Shortcut (blast radius: 1–2 drivers live today).
5. After handoff window, remove `device_id` from `analyze-offer` body schema.

---

## Part C — Phase 2 Preferences Page

**Memory trail:** #154.

### C.1 Does `/preferences` exist? **No.**

`client/src/routes.tsx` registers the following `/co-pilot/*` children (lines 118–177): `strategy` (index redirect), `bars` → `VenueManagerPage`, `briefing`, `map`, `intel`, `about`, `policy`, `concierge`, **`settings`** → `SettingsPage`, `translate`, `schedule`, `donate`, `help`.

**No `/preferences` path. No `PreferencesPage.tsx` component.** The closest existing surface is `/co-pilot/settings`.

**Latent scaffold** exists at `client/src/_future/user-settings/` — 5 TypeScript stub files (`driver.ts`, `location.ts`, `performance.ts`, `settings.ts`, `vehicleTiers.ts`). Per its README: *"staged for implementation and not currently imported."* Last verified 2026-01-06. Not wired to anything.

### C.2 `USER_PREFERENCES.md` doctrine summary (updated 2026-04-10)

**Storage:** `driver_profiles` (primary) + `driver_vehicles` (secondary).

**Categories preferences should cover:**
- Home location — `home_lat`, `home_lng`, `home_timezone`, `market` (GPS fallback, market resolution, distance-from-home)
- Vehicle class eligibility — `elig_economy` (default `true`), `elig_xl`, `elig_xxl`, `elig_comfort`, `elig_luxury_sedan`, `elig_luxury_suv`
- Vehicle attributes — `attr_electric`, `attr_green`, `attr_wav`, `attr_ski`, `attr_car_seat`
- Service preferences — `pref_pet_friendly`, `pref_teen`, `pref_assist`, `pref_shared` (unchecked = avoid these rides)
- Platforms — `rideshare_platforms JSONB` array `['uber' | 'lyft' | 'ridehail' | 'private']`
- Vehicle details — `year`, `make`, `model`, `color`, `seatbelts` (`driver_vehicles`)
- Nickname — `driver_nickname` for coach greeting + concierge public name

**Influence matrix (per doctrine §3):**
| Consumer | Status |
|----------|--------|
| Coach | **FULL ACCESS** via `CoachDAL.getDriverProfile()` — injected into system prompt (verified per Part A: `driver_profiles` + `driver_vehicles` imported in `rideshare-coach-dal.js`). |
| Strategy | **NOT YET INTEGRATED.** `consolidator.js` does not receive driver preferences. Explicit gap: economy-only drivers get identical advice to XL-eligible. |
| Venue scoring | **NOT YET INTEGRATED.** `tactical-planner.js` and `venue-intelligence.js` do not factor in prefs. All drivers see identical venue rankings. |
| GPS fallback | `home_lat` / `home_lng` used when GPS unavailable (`location-context-clean.tsx`). |

**Learning:** explicit via coach `[SAVE_NOTE]` tags into `user_intel_notes`. `note_type` ∈ `preference | insight | tip | feedback | pattern | market_update`; category ∈ `timing | location | strategy | vehicle | earnings | safety`.

### C.3 Existing settings page

- **File:** `client/src/pages/co-pilot/SettingsPage.tsx`
- **Route:** `/co-pilot/settings` (`routes.tsx:156`)
- **Sub-components:** `client/src/components/settings/UberSettingsSection.tsx` (Uber OAuth connection toggle)
- **Navigation:** exposed via `client/src/components/HamburgerMenu.tsx` and referenced in `InstructionsTab.tsx`

### C.4 Proposed path

Following the repo convention (`client/src/pages/co-pilot/<Name>Page.tsx` + registered in `routes.tsx` under `/co-pilot/<lowercase>`):

- **File:** `client/src/pages/co-pilot/PreferencesPage.tsx`
- **Route:** `/co-pilot/preferences`
- **Registration:** new children entry in `client/src/routes.tsx` next to the existing `settings` entry (currently lines 155–158).
- **Menu:** add entry to `HamburgerMenu.tsx`.

**Design question (flagged; deferred):** `USER_PREFERENCES.md` §6 already uses the phrase *"Settings UI"* for where preferences live. Two options:

| Option | Description | Trade-off |
|--------|-------------|-----------|
| **A** | Keep `SettingsPage`, add `PreferencesPage` as a sibling. Settings = account/auth/OAuth. Preferences = vehicle/service/home. | Clean separation; ships fastest; Coach reads "Preferences" mental model. |
| **B** | Rename `SettingsPage` → `PreferencesPage` with tabs (Account \| Vehicle \| Service \| Handles). | Consolidated surface; matches doctrine's "Settings UI" language. Requires existing-page refactor. |

**Recommendation:** Option A for Phase 2 scope; defer B to a later refactor.

The `driver_handles` generator UI (token creation, labeling, revocation, `last_used_at` display) belongs on the Preferences page — it pairs naturally with the "how your devices identify themselves" mental model.

---

## Part D — Client Log Hygiene

**Memory trail:** #155.

### D.1 Method

Grep over `client/` for `console.(log|info|debug|warn|error)` emissions referencing `user?.userId`, `user.userId`, `authUserId`, `userId`, or `user_id`. Verified both camelCase and snake_case. Checked for `logger.*` library (not used on client — only native `console.*`).

### D.2 Findings — 3 emissions, all in one file

| File:line | Severity | Code |
|-----------|----------|------|
| `client/src/contexts/location-context-clean.tsx:386` | **HIGH** | `console.log(\`🔐 [LocationContext] Auth state: token=${token ? 'yes' : 'no'}, userId=${user?.userId \|\| 'anonymous'}\`);` |
| `client/src/contexts/location-context-clean.tsx:489` | **HIGH** | `console.error('🔐 [LocationContext] User ID sent:', user?.userId);` |
| `client/src/contexts/location-context-clean.tsx:842` | LOWER (truncated) | `console.log(\`📍 [LocationContext] Authenticated user ${user.userId.slice(0, 8)}... starting GPS fetch\`);` |

**Line 386** is the exact line Melody observed live (`[LocationContext] Auth state: token=yes, userId=2f22004b-c5cc-43c9-a5a6-02f50ccff571`).

**Line 489** is inside an error branch (hence `console.error`). Same full-UUID leak, elevated log level.

**Line 842** emits only the first 8 chars followed by `…`. Lower leak risk — with 3 DEV users, the 8-char prefix is already unique; in prod at scale, still weaker than a boolean.

### D.3 Not-a-leak matches (data flow, not log emission — no action needed)

- `location-context-clean.tsx:618` — `user_id: locationData.user_id` (fetch body field)
- `pages/co-pilot/StrategyPage.tsx:880, 920` — `userId={localStorage.getItem('vecto_user_id') \|\| 'default'}` (prop pass)
- `constants/storageKeys.ts:21` — localStorage key name
- `utils/co-pilot-helpers.ts:166, 180` — inline doc comments

### D.4 Cleanup pattern (recommendation; NOT applied)

- **Option 1** (matches existing `slice(0, 8)` pattern at 842): `user?.userId?.slice(0, 8) ?? 'anon'`
- **Option 2** (cleaner — no identifier leak at all): `userId=${user?.userId ? 'set' : 'anonymous'}`

Lines 386 and 489 should NOT emit the full UUID. Line 842 is borderline acceptable but worth normalizing to Option 2 for consistency.

---

## Part E — Briefing Locality Audit

**Memory trail:** #156.

### E.1 Headline

The **briefing pipeline code itself is NOT hardcoded to Frisco.** The 2026-04-16 `[unknown-market]` placeholder fix already removed silent city-to-market substitution. The reason "outside Frisco shows no data" appears true is (a) one real runtime hardcoding in the **offer analyzer** (not briefing), and (b) a **seed-data coverage gap** in `venue_catalog` / `market_intelligence` / `zone_intelligence`. Drivers outside DFW will resolve their market correctly (e.g. Beaumont TX → Beaumont, Los Angeles CA → Los Angeles) but find empty intel tables.

### E.2 Frisco full-text hits (categorized)

#### Real hardcoding — operational impact

| File:line | Issue |
|-----------|-------|
| `server/api/hooks/analyze-offer.js:128` | `PHASE2_SYSTEM_PROMPT`: *"You are a rideshare offer analyst for a Dallas-Fort Worth DFW-area driver based in Frisco, TX"* |
| `server/api/hooks/analyze-offer.js:165` | *"Home base: Frisco, TX. Reject rides west of DFW Airport, Fort Worth, Denton outskirts, Anna, rural areas."* |
| `server/api/health/diagnostics.js:703` | `const { city = 'Frisco', state = 'TX' } = req.query` on `/api/diagnostics/test-traffic` (internal diagnostic; lower urgency) |

The first two are already documented at `docs/architecture/OFFER_ANALYZER.md:825` (§16 #4): *"DFW-specific geography — Won't generalize to other markets. Fix: inject driver's market/home base from their profile."*

#### Seed data — DFW-skewed by design (data gap, not code bug)

- `server/db/002_seed_dfw.sql` — `safe_zones` rows for DFW
- `server/scripts/seed-dfw-venues.js` — 16+ DFW venues (The Star in Frisco, Stonebriar, Legacy West, etc.)
- `server/scripts/seed-market-intelligence.js:473, 481, 497` — DFW-specific market intel text
- `server/scripts/seed-market-cities.js:748` — `'Frisco'` marked *KEY CITY* in seed

#### Client demo / UI — low priority

| File:line | Nature |
|-----------|--------|
| `client/src/pages/landing/LandingPage.tsx:498, 539, 540, 582, 662` | Hardcoded "Frisco, TX" in `/demo` screens |
| `client/src/types/demand-patterns.ts:110, 128` | DFW demand patterns hardcoded as data |
| `client/src/components/intel/ZoneCards.tsx:214` | `examples: 'Frisco, Santa Monica, Greenwich, Naperville'` — example list (safe) |
| `client/src/hooks/useMarketIntelligence.ts:170` | Suburb-to-market lookup map (`'frisco': 'dallas'`, etc.) — generic pattern, not hardcoding |

#### Docs / schema / tests / research — safe (examples, fixtures, reference)

- `shared/schema.js` lines 53, 808, 824, 840, 849, 863, 883 — Frisco in explanatory comments
- `shared/README.md:95` — `city_aliases` example
- `docs/architecture/*.md` — many examples (SNAPSHOT, MAP, GLOBALHEADER, etc.)
- `tests/*.tsx` + `tests/triad/*.js` — Frisco as test fixture (by design)
- `platform-data/uber/*` — Uber cities research dataset (reference)
- `scripts/verify-hallucination-fixes.mjs:11` — uses "Latest Frisco snapshot" ID for verification

### E.3 Hardcoded lat/lng near Frisco (33.1, -96.8)

All hits are legitimate:
- `server/scripts/seed-dfw-venues.js` — known Frisco venue coords (The Star 33.09, Stonebriar 33.10, Medical City Frisco 33.15)
- `server/db/002_seed_dfw.sql` — `safe_zones` seed coords
- `server/lib/location/coords-key.js:17, 30, 31, 49` — docstring examples
- `server/lib/external/faa-asws.js:288` — DAL airport `{ lat: 32.8471, lon: -96.8518 }` — legitimate airport lookup
- `server/api/hooks/README.md:33, 45` + `server/api/strategy/README.md:94` — docs examples

**No conditional branches in briefing/events/traffic code use "if near 33.1" or "if -96.8" to gate behavior.**

### E.4 `default_city` / fallback-city signals

| File:line | Finding |
|-----------|---------|
| `server/api/health/diagnostics.js:703` | `{ city = 'Frisco', state = 'TX' }` default — **REAL** |
| `scripts/test-news-fetch.js:13` | Comment confirming Frisco/TX/America_Chicago defaults were **removed** on 2026-02-13 |
| `server/api/chat/realtime.js:71` | `city: 'your location'` — generic placeholder (safe) |
| `client/src/pages/auth/SignUpPage.tsx:166` + `SettingsPage.tsx:105` | `city: ''` initialization (safe) |
| `server/api/location/location.js:98` | `console.log` fallback message only (no behavior change) |
| `docs/architecture/BRIEFING-DATA-MODEL.md:254` | Confirms 2026-04-16 fix: *"Market fallback policy — RESOLVED & IMPLEMENTED. market IS required. Historic city-substitution fallback has been removed."* |

### E.5 Briefing pipeline city-gating logic

`server/lib/briefing/briefing-service.js`:

| Line | Role |
|------|------|
| 107 | `getMarketForLocation(city, state)` — docstring: returns `market_name` or `null` |
| 111–135 | Implementation: ILIKE city, EQ state_abbr against `market_cities` |
| 123–125 | Returns market name when found |
| 128–130 | Comment: *"2026-04-16: No silent city substitution — callers handle null explicitly"* |
| 324, 979, 1078, 2383 | **All** use `market \|\| '[unknown-market]'` placeholder |
| 1080, 2385 | WARN log when null: *"No market resolved for ${city}, ${state} — event search will use [unknown-market] placeholder"* |

**No hardcoded Frisco logic. No city-specific branching. Clean pipeline.**

### E.6 Frisco-only catalogs?

**`venue_catalog` city distribution (DEV DB — top 20 of hundreds):**

| City | Rows |
|------|-----:|
| Frisco | 168 |
| Dallas | 130 |
| Plano | 60 |
| Fort Worth | 27 |
| Addison | 21 |
| The Colony | 19 |
| Beaumont | 16 |
| Allen | 9 |
| McKinney | 9 |
| Arlington | 7 |
| Irving | 6 |
| Little Elm | 5 |
| Lewisville | 4 |
| Coppell | 3 |
| Carrollton | 3 |
| Mesquite | 2 |
| Denton | 2 |
| Richardson | 2 |
| Flower Mound | 2 |
| Grand Prairie | 2 |

Coverage: DFW metro + Beaumont. **Nothing outside Texas.** Not Frisco-only but DFW-heavy (~85 %+). A driver in Houston / Austin / SF / NYC would find zero venues.

**`market_cities` coverage (static reference):** broad — California 509, Florida 206, Alabama 108, Connecticut 95, etc. Beaumont exists both in CA (Inland Empire satellite) and TX (Beaumont Core). Drivers in Beaumont-TX, LA, NYC, Houston all resolve correctly.

**`snapshots` city distribution (DEV DB):** Frisco/TX 197, Dallas/TX 11, Beaumont/TX 1. Tiny non-Frisco sample. (The single Beaumont/TX snapshot's market column incorrectly says "Austin" — driver's profile market was manually set wrong; not a briefing bug.)

### E.7 Blast radius — proposed locality-generalization scope

| Prio | Work | Scope |
|------|------|-------|
| **CRITICAL** | Parameterize `PHASE2_SYSTEM_PROMPT` in `server/api/hooks/analyze-offer.js` to inject driver's home market + home city from `driver_profiles` instead of literal "Frisco, TX / DFW". | Code — closes `OFFER_ANALYZER.md §16 #4` |
| MODERATE | Remove `'Frisco'` default from `server/api/health/diagnostics.js:703`. | Code |
| DATA OP | Expand seed coverage in `venue_catalog` / `zone_intelligence` / `market_intelligence` for additional markets as drivers onboard. | Operational (non-code) — the real user-facing reason for "no data" outside DFW |
| LOW | Genericize `LandingPage.tsx` demo screens, or make them market-aware. | Client |
| LOW | Add explicit UX state — *"No venue coverage in your market yet — contribute via Coach `[SAVE_VENUE_INTEL]`"* — instead of silent empty list. | Client + product |

---

## Proposed Phased Commit Plan

| Phase | Scope | Depends on | Parallelizable? |
|-------|-------|------------|-----------------|
| **1** | `driver_handles` table + token generator + `resolveHandle` + `analyze-offer` hard-cut (device_id → handle_token on all 4 routes) | — | No (foundation) |
| **2** | `/co-pilot/preferences` page skeleton + handle generator UI (create / label / revoke / `last_used_at` display) | Phase 1 | No |
| **3** | UberX 20-mile rule | Phase 1 (needs driver-scoped offer reads) | No |
| **4** | Briefing locality generalization (parameterize `PHASE2_SYSTEM_PROMPT`, fix diagnostics default, optionally genericize demo) | — | **Yes — independent** |
| **5a** | Scope `getOfferHistory` by `user_id` | Phase 1 | After Phase 1 |
| **5b** | Expand SELECT to include 35 currently-unread columns | Phase 1 | After Phase 1 |
| **5c** | New CoachDAL analytical helpers using unused indexes: `getOfferStatsByDaypart`, `getBestOfferZones`, `getOverridePatterns`, `getWithinSessionSequence` | Phase 1 | After Phase 1 |
| **5d** | Hook offer patterns into `consolidator.js` (strategy) and `tactical-planner.js` (venue scoring) — closes `§16 #6` | 5b, 5c | Sequential within Phase 5 |
| **5e** | Feed `user_override` back into threshold tuning — closes `§16 #5` | 5b | After 5b |
| **5f** | Add remaining operator-relevant tables to DAL imports (`driver_goals`, `driver_tasks`, `safe_zones`, `staging_saturation`, `traffic_zones`, `travel_disruptions`, `venue_events`) | — | **Yes — independent** |
| **5g** | Client log hygiene fix (3 lines in `location-context-clean.tsx`) | — | **Yes — independent** |

**Critical path:** 1 → 2 → 3.
**Always-parallel:** Phases 4, 5f, 5g (no dependency on identity foundation).
**After Phase 1 completes:** 5a–5e can run alongside Phase 2 / Phase 3.

---

## Constraints honored

- Read-only throughout the entire recon. DEV DB reads only.
- No edits to any code file.
- No schema changes. No migrations applied.
- Prod DB never touched.
- `DECISIONS.md` not modified.
- Memory entries logged after each part (#152–#157) as session-resumability insurance.

---

## Insights (verbatim from session)

### I.1 Indexes are documentation — the tell was in the index list, not the row count

> A table with `idx_oi_h3_decision`, `idx_oi_market_daypart`, `idx_oi_override`, `idx_oi_session_seq`, `idx_oi_user_id` wasn't designed to be read by a `LIMIT 20 ORDER BY created_at`. Those indexes are a fossil record of intended analytical queries that were never written. When I saw "coach reads the table," I stopped looking. I should have asked: "Does the coach read the table *the way the indexes expect*?" Indexes are documentation.

Secondary observation: `idx_oi_user_id` already existing is the kindest possible signal. The infrastructure for the migration proposed here (user-scoped offer queries via Phase 1 handles) was pre-built by whoever designed the table. They saw this coming. Phase 5a becomes a one-line `WHERE user_id = $1` addition against an already-indexed column — not a migration or a refactor.

**Proposed as doctrine #20 candidate** — awaiting Melody's approval before promotion to `DECISIONS.md`.

### I.2 Doctrine-vs-code drift is a recurring pattern

> Doctrine-vs-code drift is a recurring pattern in this repo. Memory #151 caught `coach_notes` (phantom table name in doctrine vs. `user_intel_notes` in code). This finding catches §13.1 ("for the user's device") vs. code (no `WHERE` clause). Two instances now — worth a systematic audit pass on the other tables the doctrine describes, before trusting any other claim about what the coach "reads."

**Proposed as doctrine #21 candidate** — awaiting Melody's approval before promotion to `DECISIONS.md`.

---

## Open Questions Awaiting Melody Decision

| # | Question | Options | Impact |
|---|----------|---------|--------|
| Q1 | Preferences vs. Settings naming | **A.** Add sibling `PreferencesPage` at `/co-pilot/preferences`; keep `SettingsPage` for account/OAuth. **B.** Rename `SettingsPage` → `PreferencesPage` with tabs (Account \| Vehicle \| Service \| Handles). | Phase 2 scope size. Recon recommends A. |
| Q2 | Promote doctrine #20 (indexes-as-documentation) to `DECISIONS.md`? | Yes / No / Reword | Codifies the rule for future audits. |
| Q3 | Promote doctrine #21 (doctrine-drift audit) to `DECISIONS.md`? | Yes / No / Reword | Mandates systematic audit pass across all coach-relevant tables. |
| Q4 | Phase 4 (locality generalization) timing | Parallel to Phase 1 / after Phase 1 / after Phase 3 | Independent of identity chain; can ship early. |
| Q5 | Siri Shortcut handle transition | **A.** Hard-cut `device_id` → `handle_token` (recon default; safe internally). **B.** Dual-support window of N weeks accepting both. | Affects Phase 1 rollout plan. |
| Q6 | `concierge_share_token` migration | Leave it on `driver_profiles` (current) / migrate into `driver_handles` with `label='concierge'` / retire entirely | Consistency vs. stability. |
| Q7 | Seed-data expansion (Part E data-op) | In-scope for locality work / separate data-op ticket / deferred until drivers appear outside DFW | Affects how visibly Phase 4 changes UX. |
| Q8 | Phase 5a–5e PR shape | Single PR / split by sub-phase (5a one PR, 5b+c one PR, 5d+e one PR) | Review burden vs. bisect granularity. |

---

## Memory index

| # | Part | Title |
|---|------|-------|
| 152 | A (superseded) | Coach big-table access gap — initial reading |
| 153 | B | Phase 1 identity foundation + driver_handles DDL proposal |
| 154 | C | Phase 2 preferences page recon |
| 155 | D | Client log hygiene catalog |
| 156 | E | Briefing locality audit |
| 157 | A (authoritative) | Supersedes #152 — correct multi-layer gap analysis |
